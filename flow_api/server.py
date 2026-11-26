#!/usr/bin/env python3
# ============================================================
# flow-api — serviço Cittati BI
#
# Especificação: docs/cittati_bi_servico.md
#
# Consulta o BI da Cittati (Power BI Report Server) com o login
# guardado no servidor e devolve as viagens de um dia em JSON simples,
# com CORS liberado para as rotinas do flow abertas em file://.
# Sem regra de negócio: as colunas saem como o BI devolve.
#
# Só biblioteca padrão. Configuração por variáveis de ambiente:
#   CITTATI_BI_USER, CITTATI_BI_PASSWORD   login do BI (obrigatório)
#   FLOW_API_PORT     porta local (padrão 8790)
#   FLOW_API_CACHE    pasta do cache (padrão /var/lib/flow-api/cittati)
# ============================================================

import base64
import datetime as dt
import gzip
import json
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

VERSAO = "1.0.0"

HOST      = "127.0.0.1"
PORTA     = int(os.environ.get("FLOW_API_PORT", "8790"))
CACHE_DIR = os.environ.get("FLOW_API_CACHE", "/var/lib/flow-api/cittati")

BI_BASE   = "https://bi.cittati.com.br"
REPORT_ID = "d3ed7e6d-2360-45df-848e-4d22e9567a92"
MODEL_ID  = 1063846545
ENTIDADE  = "FT_ViagensBI"

URL_QUERY = f"{BI_BASE}/powerbi/api/explore/reports/{REPORT_ID}/querydata?synchronous=true"
URL_PLANO = f"{BI_BASE}/Reports/api/v2.0/PowerBIReports({REPORT_ID})/CacheRefreshPlans"

TIMEOUT_BI     = 60        # s por chamada ao BI
PLANO_JANELA   = 600       # s entre tentativas de ler o plano de atualização
RETENCAO_DIAS  = 90        # cache mais velho que isso é apagado
JANELA_LINHAS  = 30000
MAX_PAGINAS    = 20

# Colunas de /viagens, nesta ordem. Nada com nome de pessoa:
# a rota fica aberta para a rede interna.
COLUNAS = """
idResumoViagem Data_Sem_Hora nomeEmpresa numeroLinha Sentido nomeAtendimento posicao
numeroViagem idEscala prefixo matriculaMotorista
Prev_Inicio_sem_segundos Real_Inicio_sem_segundos Prev_Fim_sem_segundos Real_Fim_sem_segundos
previstoTP realizadoTP previstoTS realizadoTS nomePontoTP nomePontoTS
distanciaTerminalSaida distanciaTerminalChegada
viagemRealizada partidaPerdida viagemExtra problemaHardware motivo
tempoViagemPrevisto tempoViagemRealizado
""".split()

COLUNA_DIA = "Data_Sem_Hora"

CORS = {"Access-Control-Allow-Origin": "*"}
CORS_PREFLIGHT = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "86400",
}


def log(msg):
    print(msg, flush=True)


def agora_iso():
    return dt.datetime.now().astimezone().replace(microsecond=0).isoformat()


class Erro(Exception):
    """Erro que vira resposta { erro, detalhe } com o status HTTP dado."""

    def __init__(self, status, codigo, detalhe):
        super().__init__(detalhe)
        self.status, self.codigo, self.detalhe = status, codigo, detalhe


# ------------------------------------------------------------
# Chamadas ao BI
# ------------------------------------------------------------

def _autorizacao():
    usuario = os.environ.get("CITTATI_BI_USER", "")
    senha = os.environ.get("CITTATI_BI_PASSWORD", "")
    if not usuario or not senha:
        raise Erro(502, "bi_erro", "Login do BI não configurado no servidor (/etc/flow-api/.env).")
    return "Basic " + base64.b64encode(f"{usuario}:{senha}".encode()).decode()


def _bi(metodo, url, corpo=None):
    """Chama o BI e devolve o JSON. Limite de TIMEOUT_BI s no total, sem novas tentativas."""
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("Authorization", _autorizacao())
    req.add_header("Accept", "application/json")
    req.add_header("Accept-Encoding", "gzip")
    if dados is not None:
        req.add_header("Content-Type", "application/json")

    limite = time.monotonic() + TIMEOUT_BI
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_BI) as r:
            partes = []
            while True:
                if time.monotonic() > limite:
                    raise TimeoutError
                bloco = r.read(256 * 1024)
                if not bloco:
                    break
                partes.append(bloco)
            bruto = b"".join(partes)
            if r.headers.get("Content-Encoding", "").lower() == "gzip":
                bruto = gzip.decompress(bruto)
    except urllib.error.HTTPError as e:
        texto = e.read(500).decode("utf-8", "replace").strip()
        raise Erro(502, "bi_erro", f"O BI respondeu HTTP {e.code}. {texto}".strip())
    except (TimeoutError, socket.timeout):
        raise Erro(504, "bi_timeout", f"O BI não respondeu em {TIMEOUT_BI} s.")
    except urllib.error.URLError as e:
        if isinstance(e.reason, (TimeoutError, socket.timeout)):
            raise Erro(504, "bi_timeout", f"O BI não respondeu em {TIMEOUT_BI} s.")
        raise Erro(502, "bi_erro", f"Sem conexão com o BI: {e.reason}")
    except OSError as e:
        raise Erro(502, "bi_erro", f"Falha na conexão com o BI: {e}")

    try:
        return json.loads(bruto)
    except ValueError:
        raise Erro(502, "bi_erro", "O BI respondeu algo que não é JSON.")


# ------------------------------------------------------------
# Plano de atualização (fora do lock do querydata)
# ------------------------------------------------------------

_plano = {"valor": None, "status": None, "erro": None, "tentativa": None}
_plano_lock = threading.Lock()   # protege só o dicionário, não a chamada


def _normalizar_hora(texto):
    """'2026-11-26T05:01:35.927-03:00' → '2026-11-26T05:01:35-03:00'."""
    try:
        return dt.datetime.fromisoformat(texto).replace(microsecond=0).isoformat()
    except (TypeError, ValueError):
        return texto


def plano():
    """Último LastRunTime conhecido. Uma tentativa a cada PLANO_JANELA s,
    com sucesso ou não; se falhar, fica o último valor conhecido."""
    with _plano_lock:
        t = _plano["tentativa"]
        if t is not None and time.monotonic() - t < PLANO_JANELA:
            return dict(_plano)
        _plano["tentativa"] = time.monotonic()

    try:
        d = _bi("GET", URL_PLANO)
        p = d["value"][0]
        valor, status, erro = _normalizar_hora(p["LastRunTime"]), p.get("LastStatus"), None
    except Erro as e:
        valor, status, erro = None, None, e.detalhe
    except (KeyError, IndexError, TypeError):
        valor, status, erro = None, None, "Plano de atualização do BI sem LastRunTime."

    with _plano_lock:
        if erro is None:
            _plano.update(valor=valor, status=status, erro=None)
        else:
            _plano["erro"] = erro
            log(f"plano de atualização: {erro}")
        return dict(_plano)


# ------------------------------------------------------------
# Consulta e decodificação
# ------------------------------------------------------------

_query_lock = threading.Lock()   # uma consulta querydata por vez


def _coluna(nome):
    return {"Column": {"Expression": {"SourceRef": {"Source": "f"}}, "Property": nome}}


def _corpo(colunas, dia_br=None, restart=None):
    consulta = {
        "Version": 2,
        "From": [{"Name": "f", "Entity": ENTIDADE, "Type": 0}],
        "Select": [dict(_coluna(c), Name=c) for c in colunas],
    }
    if dia_br:
        consulta["Where"] = [{"Condition": {"Comparison": {
            "ComparisonKind": 0,
            "Left": _coluna(COLUNA_DIA),
            "Right": {"Literal": {"Value": f"'{dia_br}'"}},
        }}}]
    janela = {"Count": JANELA_LINHAS}
    if restart is not None:
        janela["RestartTokens"] = restart
    return {
        "version": "1.0.0",
        "queries": [{
            "Query": {"Commands": [{"SemanticQueryDataShapeCommand": {
                "Query": consulta,
                "Binding": {
                    "Primary": {"Groupings": [{"Projections": list(range(len(colunas)))}]},
                    "DataReduction": {"DataVolume": 3, "Primary": {"Window": janela}},
                    "Version": 1,
                },
            }}]},
            "QueryId": "",
            "ApplicationContext": {"DatasetId": str(MODEL_ID), "Sources": [{"ReportId": REPORT_ID}]},
        }],
        "cancelQueries": [],
        "modelId": MODEL_ID,
    }


def _erro_da_resposta(resultado):
    """Erro que o BI devolve dentro de uma resposta 200 (ex.: coluna inexistente)."""
    dsr = (resultado.get("data") or {}).get("dsr") or {}
    for forma in dsr.get("DataShapes", []):
        erro = forma.get("odata.error")
        if not erro:
            continue
        ausentes = []
        for v in erro.get("azure:values", []):
            for m in v.get("additionalMessages", []):
                for item in m.get("AffectedItems", []):
                    achou = re.fullmatch(rf"{ENTIDADE}\[(.+)\]", item)
                    if achou:
                        ausentes.append(achou.group(1))
        if ausentes:
            return Erro(502, "bi_coluna_ausente",
                        f"O BI não tem a coluna {', '.join(sorted(set(ausentes)))} em {ENTIDADE}: "
                        f"a Cittati renomeou ou removeu.")
        msg = erro.get("message")
        msg = msg.get("value") if isinstance(msg, dict) else msg
        return Erro(502, "bi_erro", f"{erro.get('code', 'erro')}: {msg}")
    return None


def _decodificar(ds, n):
    """Linhas do formato DSR. Com várias colunas os valores vêm em 'C'
    (omitindo os marcados em R = repete a linha anterior e Ø = nulo);
    com uma coluna só vêm em chaves 'G0', 'G1'..."""
    linhas, anterior, chaves, dicionarios = [], [None] * n, [], {}
    valores_dict = ds.get("ValueDicts", {})
    for r in ds["PH"][0].get("DM0", []):
        if "S" in r:
            chaves = [s.get("N") for s in r["S"]]
            dicionarios = {i: s.get("DN") for i, s in enumerate(r["S"]) if s.get("DN")}
            if len(chaves) != n:
                raise ValueError(f"esperava {n} colunas e o BI mandou {len(chaves)}")
        repete, nulo = r.get("R", 0), r.get("Ø", 0)
        seq = iter(r["C"]) if "C" in r else None
        linha = []
        for i in range(n):
            if repete >> i & 1:
                linha.append(anterior[i])
                continue
            if nulo >> i & 1:
                linha.append(None)
                continue
            if seq is not None:
                v = next(seq)          # StopIteration → formato inesperado
            elif chaves[i] in r:
                v = r[chaves[i]]
            else:
                raise ValueError(f"linha sem valor para {chaves[i]}")
            if i in dicionarios and isinstance(v, int):
                v = valores_dict[dicionarios[i]][v]
            linha.append(v)
        if seq is not None and next(seq, StopIteration) is not StopIteration:
            raise ValueError("linha com mais valores que colunas")
        anterior = linha
        linhas.append(linha)
    return linhas, ds.get("RT")


def consultar(colunas, dia_br=None):
    """Consulta o BI (com o lock já tomado por quem chama) e devolve
    (linhas como listas, segundos gastos). Trata a paginação pelo RT."""
    inicio = time.monotonic()
    todas, restart = [], None
    for pagina in range(MAX_PAGINAS):
        d = _bi("POST", URL_QUERY, _corpo(colunas, dia_br, restart))
        try:
            resultado = d["results"][0]["result"]
        except (KeyError, IndexError, TypeError):
            raise Erro(502, "bi_erro", f"Resposta do BI fora do formato: {json.dumps(d)[:500]}")
        erro = _erro_da_resposta(resultado)
        if erro:
            raise erro
        if "data" not in resultado:
            raise Erro(502, "bi_erro", f"Consulta ao BI falhou: {json.dumps(resultado)[:500]}")
        try:
            data = resultado["data"]
            nomes = [s.get("Name") for s in data["descriptor"]["Select"]]
            faltando = [c for c in colunas if c not in nomes]
            if faltando:
                raise Erro(502, "bi_coluna_ausente",
                           f"A resposta do BI veio sem a coluna {', '.join(faltando)}: "
                           f"a Cittati renomeou ou removeu.")
            if nomes != list(colunas):
                raise Erro(502, "bi_erro", "O BI devolveu as colunas fora da ordem pedida.")
            linhas, restart = _decodificar(data["dsr"]["DS"][0], len(colunas))
        except Erro:
            raise
        except (KeyError, IndexError, TypeError, ValueError, StopIteration) as e:
            raise Erro(502, "bi_erro", f"Resposta do BI fora do formato esperado ({e}).")
        if pagina > 0 and linhas:
            linhas = linhas[1:]        # a página nova repete a última linha da anterior
        todas.extend(linhas)
        if not restart:
            return todas, time.monotonic() - inicio
    raise Erro(502, "bi_erro", f"O BI pediu mais de {MAX_PAGINAS} páginas para a consulta.")


# ------------------------------------------------------------
# Datas
# ------------------------------------------------------------

def validar_data(texto):
    if not texto or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", texto):
        raise Erro(400, "data_invalida", "Informe data=AAAA-MM-DD.")
    try:
        return dt.date.fromisoformat(texto)
    except ValueError:
        raise Erro(400, "data_invalida", f"{texto} não é uma data válida.")


def br_para_iso(texto):
    """'25/11/2026' → '2026-11-25'; None se não for uma data válida."""
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", texto.strip()) if isinstance(texto, str) else None
    if not m:
        return None
    try:
        return dt.date(int(m[3]), int(m[2]), int(m[1])).isoformat()
    except ValueError:
        return None


# ------------------------------------------------------------
# Cache
# ------------------------------------------------------------

def _arquivo(dia_iso):
    return os.path.join(CACHE_DIR, f"{dia_iso}.json.gz")


def ler_cache(dia_iso):
    try:
        with gzip.open(_arquivo(dia_iso), "rb") as f:
            return json.loads(f.read())
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as e:
        log(f"cache {dia_iso} ilegível, será refeito: {e}")
        return None


def gravar_cache(dia_iso, resposta):
    os.makedirs(CACHE_DIR, exist_ok=True)
    final = _arquivo(dia_iso)
    tmp = f"{final}.{os.getpid()}.{threading.get_ident()}.tmp"
    with gzip.open(tmp, "wb", compresslevel=6) as f:
        f.write(json.dumps(resposta, ensure_ascii=False, separators=(",", ":")).encode())
    os.replace(tmp, final)


def cache_valido(cache, p):
    """Usa o cache se o LastRunTime atual for igual ao guardado. Sem plano
    conhecido (nunca respondeu), qualquer cache existente serve."""
    if cache is None:
        return False
    if p["valor"] is None:
        return True
    return cache.get("biAtualizadoEm") == p["valor"]


def limpar_cache():
    limite = dt.date.today() - dt.timedelta(days=RETENCAO_DIAS)
    try:
        nomes = os.listdir(CACHE_DIR)
    except FileNotFoundError:
        return
    for nome in nomes:
        m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})\.json\.gz(\..+\.tmp)?", nome)
        if not m:
            continue
        try:
            velho = dt.date.fromisoformat(m[1]) < limite
        except ValueError:
            continue
        if velho or m[2]:
            try:
                os.remove(os.path.join(CACHE_DIR, nome))
                log(f"cache apagado: {nome}")
            except OSError as e:
                log(f"não consegui apagar {nome}: {e}")


def _limpeza_diaria():
    while True:
        try:
            limpar_cache()
        except Exception as e:  # noqa: BLE001 — a limpeza não pode derrubar o serviço
            log(f"limpeza do cache falhou: {e}")
        time.sleep(24 * 3600)


# ------------------------------------------------------------
# Rotas
# ------------------------------------------------------------

_dias_cache = None   # { biAtualizadoEm, dias } em memória


def rota_saude(_q, info):
    p = plano()
    corpo = {"ok": p["erro"] is None and p["valor"] is not None, "versao": VERSAO,
             "biAtualizadoEm": p["valor"], "biStatus": p["status"]}
    if not corpo["ok"]:
        corpo["erro"] = p["erro"] or "Plano de atualização do BI ainda não consultado."
    return 200, corpo


def rota_dias(q, info):
    global _dias_cache
    p = plano()
    forcar = q.get("atualizar") == "1"
    if not forcar and cache_valido(_dias_cache, p):
        info["cache"] = True
        return 200, _dias_cache
    with _query_lock:
        if not forcar and cache_valido(_dias_cache, p):
            info["cache"] = True
            return 200, _dias_cache
        linhas, gasto = consultar([COLUNA_DIA])
        info["bi_s"] = gasto
        dias = sorted({d for d in (br_para_iso(l[0]) for l in linhas) if d})
        _dias_cache = {"biAtualizadoEm": p["valor"], "dias": dias}
        info["cache"] = False
        return 200, _dias_cache


def rota_viagens(q, info):
    dia = validar_data(q.get("data"))
    dia_iso = dia.isoformat()
    info["data"] = dia_iso
    forcar = q.get("atualizar") == "1"
    p = plano()   # lido antes do querydata: é esse o valor guardado no cache

    if not forcar:
        cache = ler_cache(dia_iso)
        if cache_valido(cache, p):
            info["cache"] = True
            return 200, dict(cache, doCache=True)

    with _query_lock:
        if not forcar:   # outro pedido pode ter montado o cache enquanto esperávamos
            cache = ler_cache(dia_iso)
            if cache_valido(cache, p):
                info["cache"] = True
                return 200, dict(cache, doCache=True)

        gerado = agora_iso()
        linhas, gasto = consultar(COLUNAS, dia.strftime("%d/%m/%Y"))
        info["bi_s"] = gasto
        info["cache"] = False
        if not linhas:
            raise Erro(404, "dia_sem_dados",
                       f"O BI não tem viagens em {dia.strftime('%d/%m/%Y')}. "
                       f"O BI só traz até ontem; o dia entra na atualização da madrugada seguinte.")
        ids = [l[0] for l in linhas]
        if len(set(ids)) != len(ids):
            raise Erro(502, "bi_erro", f"O BI devolveu idResumoViagem repetido "
                                       f"({len(ids) - len(set(ids))} repetições) para {dia_iso}.")
        resposta = {
            "data": dia_iso,
            "biAtualizadoEm": p["valor"],
            "geradoEm": gerado,
            "doCache": False,
            "total": len(linhas),
            "colunas": COLUNAS,
            "viagens": [dict(zip(COLUNAS, l)) for l in linhas],
        }
        gravar_cache(dia_iso, resposta)
        return 200, resposta


ROTAS = {
    "/cittati/saude": rota_saude,
    "/cittati/dias": rota_dias,
    "/cittati/viagens": rota_viagens,
}


class Handler(BaseHTTPRequestHandler):
    def version_string(self):
        return "flow-api/" + VERSAO

    def log_message(self, *args):   # o log padrão é trocado pelo nosso, em _responder
        pass

    def _responder(self, status, corpo, extra=None):
        dados = b"" if corpo is None else json.dumps(
            corpo, ensure_ascii=False, separators=(",", ":")).encode()
        cabecalhos = dict(CORS, **(extra or {}))
        if dados:
            cabecalhos["Content-Type"] = "application/json; charset=utf-8"
            cabecalhos["Vary"] = "Accept-Encoding"
            aceita = self.headers.get("Accept-Encoding", "")
            if len(dados) > 1024 and "gzip" in aceita.lower():
                dados = gzip.compress(dados, compresslevel=6)
                cabecalhos["Content-Encoding"] = "gzip"
        cabecalhos["Content-Length"] = str(len(dados))
        self.send_response(status)
        for k, v in cabecalhos.items():
            self.send_header(k, v)
        self.end_headers()
        if dados and self.command != "HEAD":
            self.wfile.write(dados)

    def do_OPTIONS(self):
        self._responder(204, None, CORS_PREFLIGHT)
        self._log(urlsplit(self.path).path, {}, 204, time.monotonic())

    def do_GET(self):
        inicio = time.monotonic()
        partes = urlsplit(self.path)
        caminho = partes.path.rstrip("/") or "/"
        q = {k: v[-1] for k, v in parse_qs(partes.query).items()}
        info = {}
        rota = ROTAS.get(caminho)
        try:
            if rota is None:
                raise Erro(404, "rota_inexistente", f"Rota {caminho} não existe.")
            status, corpo = rota(q, info)
        except Erro as e:
            status, corpo = e.status, {"erro": e.codigo, "detalhe": e.detalhe}
        except Exception as e:  # noqa: BLE001
            log(f"erro interno em {caminho}: {type(e).__name__}: {e}")
            status, corpo = 500, {"erro": "erro_interno", "detalhe": f"{type(e).__name__}: {e}"}
        try:
            self._responder(status, corpo)
        except (BrokenPipeError, ConnectionResetError):
            pass
        self._log(caminho, info, status, inicio, corpo.get("erro") if isinstance(corpo, dict) else None)

    def _log(self, caminho, info, status, inicio, erro=None):
        partes = [self.command, caminho]
        if "data" in info:
            partes.append(f"data={info['data']}")
        if "cache" in info:
            partes.append("cache=sim" if info["cache"] else "cache=nao")
        if "bi_s" in info:
            partes.append(f"bi={info['bi_s']:.1f}s")
        partes.append(f"{(time.monotonic() - inicio) * 1000:.0f}ms")
        partes.append(str(status))
        if erro:
            partes.append(erro)
        log(" ".join(partes))


def main():
    os.makedirs(CACHE_DIR, exist_ok=True)
    if not os.environ.get("CITTATI_BI_USER") or not os.environ.get("CITTATI_BI_PASSWORD"):
        log("aviso: CITTATI_BI_USER/CITTATI_BI_PASSWORD não definidos; as consultas ao BI vão falhar")
    threading.Thread(target=_limpeza_diaria, daemon=True).start()
    servidor = ThreadingHTTPServer((HOST, PORTA), Handler)
    servidor.daemon_threads = True
    log(f"flow-api {VERSAO} em http://{HOST}:{PORTA}, cache em {CACHE_DIR}")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
