# Serviço Cittati BI — especificação

> Para quem vai implementar o serviço no servidor `rafaelplan.local`. Este documento é o contrato: o que construir, onde, como o BI responde e como saber que ficou pronto.

---

## Por que existe

As rotinas do **flow** (HTML + JS puro) ficam numa pasta de rede e são abertas direto nas máquinas Windows dos operadores (`file://`). Elas não têm servidor nem Python. A rotina `pax_consolidar` vai validar a operação de um dia usando as viagens do **BI da Cittati**: o que estava previsto, o que rodou, horários reais, motivos.

O navegador não consegue chamar o BI direto: o BI exige login e **não libera CORS**. O serviço fica no meio, com três tarefas:

1. guardar o login do BI (ele nunca sai do servidor);
2. consultar o BI, decodificar a resposta e devolver as viagens de um dia em JSON simples;
3. responder com CORS liberado, para que uma página aberta em `file://` consiga chamá-lo.

O serviço **não tem regra de negócio**. Ele não classifica viagem, não interpreta motivo e não junta nada com a bilhetagem: devolve as colunas do BI como vieram. Toda a análise fica no `pax_consolidar`.

---

## Onde roda

| | |
|---|---|
| Máquina | Ubuntu, `192.168.1.144`, acessada como `rafaelplan.local` (mDNS) |
| Entrada | nginx 1.28 já instalado, HTTPS com certificado emitido pela `Nyx Local CA (rafaelplan)`; `http://` redireciona para `https://` |
| Já ocupa a máquina | o **nyx**: `/` (Next.js, redireciona para `/login`) e `/api` (NestJS) |

- O serviço roda em `127.0.0.1:8790` e o nginx o publica em **`https://rafaelplan.local/flow-api/`**.
- O bloco `location /flow-api/` precisa ficar **antes** da regra que manda tudo para o Next. Hoje `/cittati` cai no Next e responde 307 para `/login`.
- **Não altere nada do nyx.** Só acrescente o `location`.
- Se a porta 8790 estiver ocupada, use outra e anote aqui.

---

## Implementação

- **Python 3 só com a biblioteca padrão** (`http.server.ThreadingHTTPServer`, `urllib.request`, `json`, `gzip`). Nada de pip nem venv.
- Código em `/opt/flow-api/` (ou onde fizer sentido na máquina; anote aqui). Dono: um usuário de sistema sem login (`flow-api`), não root.
- Login do BI em `/etc/flow-api/.env`, permissão `600`, dono `flow-api`, fora de qualquer repositório:

  ```
  CITTATI_BI_USER=...
  CITTATI_BI_PASSWORD=...
  ```

  Peça os valores ao Rafael. Se o nyx já estiver configurado nessa máquina, eles são os mesmos do `.env` da API do nyx, com os mesmos nomes de variável.
- Serviço systemd `flow-api.service`: `Restart=always`, sobe no boot, lê o `.env` por `EnvironmentFile=`.
- Log no journal: uma linha por requisição, com rota, data pedida, se veio do cache, tempo e status. **Nunca** logar login, senha ou o cabeçalho `Authorization`.

---

## API

Base: `https://rafaelplan.local/flow-api/cittati`

Todas as respostas são `application/json; charset=utf-8` e levam:

```
Access-Control-Allow-Origin: *
```

Responda `OPTIONS` com `204` e os cabeçalhos abaixo (o cliente só usa GET simples, mas o preflight não deve falhar):

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Private-Network: true
```

Uma página em `file://` envia `Origin: null`; o `*` cobre esse caso. Não há cookies nem credenciais do lado do cliente.

### `GET /saude`

Confere se o serviço está de pé e quando o BI foi atualizado pela última vez.

```json
{ "ok": true, "versao": "1.0.0", "biAtualizadoEm": "2026-11-26T05:01:35-03:00", "biStatus": "Completed Data Refresh" }
```

`biAtualizadoEm` e `biStatus` vêm do plano de atualização do BI (ver [Atualização do BI](#atualização-do-bi)). Se o BI não responder: `"ok": false` e `"erro"` com o motivo, HTTP 200. Esta rota serve para diagnóstico e não deve falhar.

### `GET /dias`

Lista os dias que existem no BI. O `pax_consolidar` usa para montar a escolha de data.

```json
{ "biAtualizadoEm": "...", "dias": ["2026-11-03", "2026-11-04", "...", "2026-11-25"] }
```

É uma consulta pequena, só com a coluna `Data_Sem_Hora` (ver [Consultar](#consultar)). Guarde em cache até a próxima atualização do BI.

### `GET /viagens?data=AAAA-MM-DD`

Todas as viagens do **dia operacional**, de todas as empresas, uma linha por viagem. O cliente filtra a empresa.

```json
{
  "data": "2026-11-25",
  "biAtualizadoEm": "2026-11-26T05:01:35-03:00",
  "geradoEm": "2026-11-26T08:40:12-03:00",
  "doCache": true,
  "total": 7413,
  "colunas": ["idResumoViagem", "Data_Sem_Hora", "..."],
  "viagens": [
    { "idResumoViagem": -1729571629, "Data_Sem_Hora": "25/11/2026", "nomeEmpresa": "Rápido Cuiabá Transporte Urbano", "...": "..." }
  ]
}
```

- Os valores saem **como o BI devolve**, já decodificados: texto continua texto, número continua número, ausente é `null`. Não converter datas, não traduzir `Sim`/`Não`, não aparar espaços.
- `geradoEm` é a hora em que o serviço consultou o BI para montar aquele cache.
- Comprimir com gzip quando o cliente aceitar (`Accept-Encoding`). Um dia inteiro dá ~6,5 MB de JSON e ~310 KB comprimido. Pode ser no Python ou no nginx (`gzip on; gzip_types application/json;`).

Erros, sempre `{ "erro": "<código>", "detalhe": "<texto para pessoa>" }`:

| HTTP | `erro` | Quando |
|---|---|---|
| 400 | `data_invalida` | `data` ausente ou fora do formato `AAAA-MM-DD` |
| 404 | `dia_sem_dados` | O BI respondeu sem nenhuma viagem para o dia. O dia de hoje sempre cai aqui, porque o BI só traz até ontem. |
| 502 | `bi_erro` | O BI respondeu erro, ou a resposta não tem o formato esperado |
| 502 | `bi_coluna_ausente` | Faltou alguma coluna da lista na resposta. `detalhe` diz qual: a Cittati renomeou ou removeu |
| 504 | `bi_timeout` | O BI não respondeu em 60 s |

### Colunas de `/viagens`

Uma lista só, numa constante no topo do código. Selecione exatamente estas, nesta ordem:

```
idResumoViagem Data_Sem_Hora nomeEmpresa numeroLinha Sentido nomeAtendimento posicao
numeroViagem idEscala prefixo matriculaMotorista
Prev_Inicio_sem_segundos Real_Inicio_sem_segundos Prev_Fim_sem_segundos Real_Fim_sem_segundos
previstoTP realizadoTP previstoTS realizadoTS nomePontoTP nomePontoTS
distanciaTerminalSaida distanciaTerminalChegada
viagemRealizada partidaPerdida viagemExtra problemaHardware motivo
tempoViagemPrevisto tempoViagemRealizado
```

**Não incluir** `nomeMotorista`, `nomeCobrador` nem outras colunas com nome de pessoa: a rota fica aberta para a rede interna. A matrícula basta.

---

## Cache

Um arquivo por dia em `/var/lib/flow-api/cittati/AAAA-MM-DD.json` (ou `.json.gz`), guardando a resposta de `/viagens` e o `biAtualizadoEm` da consulta.

- **Quando consultar o BI de novo:** só quando o BI tiver sido atualizado depois do cache daquele dia. O BI atualiza uma vez por dia, de madrugada. Sem atualização nova, responda do cache com `"doCache": true`.
  - Fique de olho nisso: o operador corrige uma viagem na Cittati num dia e confere no dia seguinte, depois da atualização. O cache **não pode** esconder essa correção.
- Para saber a hora da última atualização, consulte o plano de atualização no máximo **a cada 10 minutos** e guarde em memória.
- **Uma consulta ao BI por vez** (um lock). Se dois pedidos chegarem para o mesmo dia sem cache, o segundo espera o primeiro e usa o resultado. A conta é única e compartilhada com a operação, e o limite de uso do BI é desconhecido.
- `?atualizar=1` ignora o cache daquele dia (para diagnóstico).
- Apague arquivos com mais de **90 dias** (pode ser na subida do serviço ou uma vez por dia).
- Opcional: depois de detectar uma atualização nova do BI, refazer o cache dos últimos 7 dias em segundo plano, com intervalo entre as consultas. Não é necessário na primeira versão.

---

## O BI

Power BI Report Server da Cittati. Não é uma API documentada: é o endpoint que o próprio visualizador de relatórios usa. Referência completa, com o que já foi testado: `docs/integrations/cittati/README.md` no repositório do **nyx**.

| | |
|---|---|
| Autenticação | HTTP **Basic** em toda chamada |
| Relatório | id `d3ed7e6d-2360-45df-848e-4d22e9567a92` |
| Modelo | id `1063846545` |
| Consulta | `POST https://bi.cittati.com.br/powerbi/api/explore/reports/<reportId>/querydata?synchronous=true` |
| Plano de atualização | `GET https://bi.cittati.com.br/Reports/api/v2.0/PowerBIReports(<reportId>)/CacheRefreshPlans` |

O endpoint de schema (`conceptualschema`) está retornando erro desde 2026-11-26, enquanto `querydata` funciona. **Não dependa do schema**: confira as colunas na própria resposta.

### Atualização do BI

`CacheRefreshPlans` → `value[0].LastRunTime` (ex.: `2026-11-26T05:01:35.927-03:00`) e `value[0].LastStatus` (`Completed Data Refresh`). Atualização diária a partir das 02:00; até as ~05:00 o dia anterior está completo.

### Consultar

Corpo da consulta. Troque `<SELECT>`, `<PROJ>` e a data:

```json
{
  "version": "1.0.0",
  "queries": [{
    "Query": { "Commands": [{ "SemanticQueryDataShapeCommand": {
      "Query": {
        "Version": 2,
        "From": [{ "Name": "f", "Entity": "FT_ViagensBI", "Type": 0 }],
        "Select": <SELECT>,
        "Where": [{ "Condition": { "Comparison": { "ComparisonKind": 0,
          "Left":  { "Column": { "Expression": { "SourceRef": { "Source": "f" } }, "Property": "Data_Sem_Hora" } },
          "Right": { "Literal": { "Value": "'25/11/2026'" } } } } }]
      },
      "Binding": {
        "Primary": { "Groupings": [{ "Projections": <PROJ> }] },
        "DataReduction": { "DataVolume": 3, "Primary": { "Window": { "Count": 30000 } } },
        "Version": 1
      }
    }}]},
    "QueryId": "",
    "ApplicationContext": { "DatasetId": "1063846545", "Sources": [{ "ReportId": "d3ed7e6d-2360-45df-848e-4d22e9567a92" }] }
  }],
  "cancelQueries": [],
  "modelId": 1063846545
}
```

- `<SELECT>`: um item por coluna, `{ "Column": { "Expression": { "SourceRef": { "Source": "f" } }, "Property": "<coluna>" }, "Name": "<coluna>" }`.
- `<PROJ>`: os índices `[0, 1, …, n-1]`.
- O filtro é **`Data_Sem_Hora`**, um texto `DD/MM/AAAA` entre aspas simples dentro da string. Ele é o dia operacional: as viagens de 25/11 vão até ~03:30 de 26/11. Não filtre pela coluna `Data` nem pelos horários.
- **Para `/dias`:** só a coluna `Data_Sem_Hora`, sem `Where`. A resposta vem agrupada: uma linha por dia distinto.

### Decodificar

A resposta está em `results[0].result.data.dsr.DS[0]`. Se `results[0].result` não tiver `data`, a consulta falhou: devolva `bi_erro` com o conteúdo em `detalhe`.

```python
def decode(ds, names):
    rows, prev, dn = [], [None] * len(names), {}
    for r in ds['PH'][0].get('DM0', []):
        for i, s in enumerate(r.get('S', [])):
            dn[i] = s.get('DN')
        vals, out = iter(r.get('C', [])), []
        for i in range(len(names)):
            if r.get('R', 0) >> i & 1:
                out.append(prev[i])            # repete o valor da linha anterior
            elif r.get('Ø', 0) >> i & 1:
                out.append(None)               # nulo
            else:
                v = next(vals)
                if dn.get(i) and isinstance(v, int):
                    v = ds['ValueDicts'][dn[i]][v]   # texto vem como índice num dicionário
                out.append(v)
        prev = out
        rows.append(dict(zip(names, out)))
    return rows, ds.get('RT')
```

- **Paginação:** se vier `RT`, há mais linhas. Reenvie a consulta com `"Window": { "Count": 30000, "RestartTokens": <RT> }`. **A primeira linha da página nova repete a última da anterior**: descarte-a. Um dia inteiro (~7.400 viagens) cabe numa página, mas trate o `RT` mesmo assim.
- Confira se toda coluna pedida veio na resposta e se nenhum `idResumoViagem` se repete. Se não, devolva erro e não grave cache.

Timeout de 60 s por chamada ao BI. Sem novas tentativas automáticas: devolva o erro.

---

## Pronto quando

Rodando no próprio servidor:

```bash
curl -s https://rafaelplan.local/flow-api/cittati/saude --cacert <CA da Nyx>
# ok: true e biAtualizadoEm preenchido

curl -s https://rafaelplan.local/flow-api/cittati/dias --cacert <CA da Nyx>
# começa em 2026-11-03 e termina ontem

curl -s --compressed 'https://rafaelplan.local/flow-api/cittati/viagens?data=2026-11-25' --cacert <CA da Nyx> \
  | python3 -c 'import json,sys,collections; d=json.load(sys.stdin); print(d["total"], d["doCache"]); print(collections.Counter(v["nomeEmpresa"] for v in d["viagens"]))'
```

Referência para 2026-11-25, conferida em 2026-11-26 (pode mudar um pouco se a Cittati corrigir viagens):

| | |
|---|---|
| Total | 7.413 viagens, todas com `idResumoViagem` distinto |
| VPAR Transportes e Serviços SPE | 1.820 |
| Integração Transporte | 1.317 |
| Rápido Cuiabá Transporte Urbano | 1.260 (885 com `viagemRealizada = "Sim"`) |
| Caribus Transportes e Serviços | 1.191 |
| União Transporte e Turismo | 941 |
| Consórcio Metropolitano de Transportes | 884 |
| Tempo da consulta ao BI | ~3 s |

Confira também:

- a segunda chamada de `/viagens` para o mesmo dia vem com `"doCache": true` e sem consultar o BI (veja no log);
- `/viagens?data=<hoje>` dá 404 `dia_sem_dados`, e `/viagens?data=25-11-2026` dá 400;
- `curl -s -X OPTIONS -i .../viagens` dá 204 com os cabeçalhos de CORS;
- o `.env` tem permissão 600 e o login não aparece no `journalctl -u flow-api`;
- `systemctl restart` e um reboot trazem o serviço de volta;
- o nyx continua funcionando (`https://rafaelplan.local/` redireciona para `/login`).

---

## Fora do servidor: máquinas dos operadores

Não é tarefa de quem implementa o serviço, mas sem isso o `pax_consolidar` não alcança o serviço. Testar numa máquina Windows de operador, abrindo no navegador `https://rafaelplan.local/flow-api/cittati/saude`:

1. **Nome.** Se `rafaelplan.local` não resolver (o `.local` depende de mDNS, e o Windows nem sempre resolve), use o IP `192.168.1.144`, que já está no certificado, ou uma entrada no DNS da rede.
2. **Certificado.** Se o navegador reclamar do certificado, a máquina não confia na `Nyx Local CA`. Uma chamada feita pela página falha sem aviso nenhum, então é preciso instalar a CA em "Autoridades de Certificação Raiz Confiáveis" (manual ou por GPO). Vale também para quando os operadores passarem a usar o nyx.
3. **Rede local.** O Chrome/Edge podem pedir permissão para uma página acessar a rede local. Se aparecer o pedido ao rodar o `pax_consolidar`, permita.
