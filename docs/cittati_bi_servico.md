# Serviço Cittati BI — especificação

> Para quem vai implementar o serviço no servidor `rafaelplan.local`. Este documento é o contrato: o que construir, onde, como o BI responde e como saber que ficou pronto.
>
> **Situação:** implementado e no ar desde 2026-11-26. Código em [`flow_api/`](../flow_api/) neste repositório, instalado por `sudo bash flow_api/install.sh`. O que foi conferido e o que falta está em [Pronto quando](#pronto-quando).

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

- O serviço roda em `127.0.0.1:8790` e o nginx o publica em **`https://rafaelplan.local/flow-api/`** (também responde pelo IP `https://192.168.1.144/flow-api/`).
- A ordem dos blocos no nginx não importa: para `location` por prefixo vale o prefixo mais longo, então `/flow-api/` ganha de `/` onde quer que esteja. A ordem só conta para `location` com expressão regular.
- **Não altere o comportamento do nyx.**

### nginx: um arquivo por serviço

O site do nyx era um arquivo único (`/etc/nginx/sites-available/nyx`), feito à mão e fora de qualquer repositório. Para não ter de editar o arquivo do nyx a cada serviço novo, ele foi repartido, **sem mudar nenhuma diretiva**, num site da máquina mais um par de arquivos por aplicação:

| Arquivo | Conteúdo |
|---|---|
| `/etc/nginx/sites-available/rafaelplan` (ligado em `sites-enabled/`) | http → https, download da CA (`/nyx-ca.crt`), TLS, e os `include` abaixo |
| `/etc/nginx/rafaelplan.d/<app>.http.conf` | nível http: `upstream`, `map` |
| `/etc/nginx/rafaelplan.d/<app>.server.conf` | dentro do `server` 443: os `location` da aplicação |
| `rafaelplan.d/nyx.http.conf`, `nyx.server.conf` | o conteúdo antigo do nyx, movido sem mudança |
| `rafaelplan.d/flow-api.server.conf` | `location /flow-api/` → `127.0.0.1:8790`, `proxy_read_timeout 90s` (o BI tem 60 s; a folga deixa o serviço devolver o `bi_timeout`) |

Um serviço novo nesta máquina é só mais um `<app>.server.conf`. O `sites-available/nyx` original ficou no disco, desligado, como cópia. As fontes desses arquivos estão em [`flow_api/nginx/`](../flow_api/nginx/); o `install.sh` faz a migração uma vez só, confere antes se o arquivo do nyx é o esperado e desfaz tudo se o `nginx -t` falhar.

**Observado no nyx (não corrigido, de propósito):** os dois `location` do nyx definem `proxy_set_header` próprios. No nginx, isso faz o `location` **não herdar** os `proxy_set_header` do `server`, então `/api/` e `/` hoje não recebem `Host`, `X-Real-IP` nem `X-Forwarded-*`. Vale olhar do lado do nyx.

---

## Implementação

- **Python 3 só com a biblioteca padrão** (`http.server.ThreadingHTTPServer`, `urllib.request`, `json`, `gzip`). Nada de pip nem venv.
- Fonte versionada em [`flow_api/`](../flow_api/) neste repositório: `server.py`, `flow-api.service`, `nginx/` e `install.sh`. O `install.sh` copia o código para `/opt/flow-api/` (dono root, só leitura para o serviço) e pode ser rodado de novo a cada mudança no `server.py`: ele reinicia o serviço e recarrega o nginx, sem nunca sobrescrever o `.env` nem os arquivos do nyx.
- O serviço roda como um usuário de sistema sem login (`flow-api`), não root, com o systemd travando o resto do sistema em só leitura (`ProtectSystem=strict`); só `/var/lib/flow-api` é gravável.
- Login do BI em `/etc/flow-api/.env`, permissão `600`, dono `flow-api`, fora de qualquer repositório:

  ```
  CITTATI_BI_USER=...
  CITTATI_BI_PASSWORD=...
  ```

  São os mesmos do `.env` da API do nyx (`/srv/nyx/apps/api/.env`), com os mesmos nomes de variável. Na primeira instalação o `install.sh` copia só essas duas linhas de lá; depois o arquivo é mantido. Se o nyx não tiver o login, o arquivo nasce com os campos vazios para preencher, e depois `sudo systemctl restart flow-api`.
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

É uma consulta pequena, só com a coluna `Data_Sem_Hora` (ver [Consultar](#consultar)). Cache em memória, com a mesma regra de `/viagens` (ver [Cache](#cache)).

**Exceção à regra de não converter:** o BI devolve `DD/MM/AAAA`; aqui as datas saem como `AAAA-MM-DD`, sem repetições e em ordem crescente. Valores que não forem uma data válida são ignorados.

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

- Os valores saem **como o BI devolve**, já decodificados: texto continua texto, número continua número, ausente é `null`. Não converter datas (`Data_Sem_Hora` sai `25/11/2026`), não traduzir `Sim`/`Não`, não aparar espaços. Só o `data` do topo da resposta vem em `AAAA-MM-DD`, repetindo o que foi pedido.
- `data` precisa ser `AAAA-MM-DD` **e** uma data real (`2026-02-30` dá 400 `data_invalida`).
- Também saem como vieram as colunas de data e hora do BI: `previstoTP`, `realizadoTP`, `previstoTS` e `realizadoTS` chegam como **epoch em milissegundos** (`1795583400000`), e os `*_sem_segundos` como texto (`25/11/2026 05:10`).
- `geradoEm` é a hora em que o serviço consultou o BI para montar aquele cache, no fuso da máquina (`-04:00`, Cuiabá). `biAtualizadoEm` mantém o fuso do BI (`-03:00`), sem os milissegundos.
- Gzip quando o cliente aceitar (`Accept-Encoding`), feito no Python: o `gzip on` do nginx não inclui JSON, e a configuração global do nginx não foi mexida. Um dia inteiro dá ~6,5 MB de JSON e ~345 KB comprimido.

Erros, sempre `{ "erro": "<código>", "detalhe": "<texto para pessoa>" }`:

| HTTP | `erro` | Quando |
|---|---|---|
| 400 | `data_invalida` | `data` ausente, fora do formato `AAAA-MM-DD` ou data que não existe |
| 404 | `dia_sem_dados` | O BI respondeu sem nenhuma viagem para o dia. O dia de hoje sempre cai aqui, porque o BI só traz até ontem. |
| 404 | `rota_inexistente` | Caminho que não é `/saude`, `/dias` nem `/viagens` |
| 500 | `erro_interno` | Falha do próprio serviço (sai no log) |
| 502 | `bi_erro` | O BI respondeu erro, ou a resposta não tem o formato esperado. Também quando o `.env` está sem login |
| 502 | `bi_coluna_ausente` | Faltou alguma coluna da lista na resposta. `detalhe` diz qual: a Cittati renomeou ou removeu |
| 504 | `bi_timeout` | O BI não respondeu em 60 s |

`/dias` usa os mesmos códigos `bi_*`.

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

Um arquivo por dia em `/var/lib/flow-api/cittati/AAAA-MM-DD.json.gz` (~350 KB), guardando a resposta de `/viagens` e o `biAtualizadoEm` da consulta. A gravação é atômica (arquivo temporário + `rename`). O cache de `/dias` fica só em memória: depois de um reinício custa uma consulta pequena.

O `biAtualizadoEm` guardado é o valor conhecido **antes** do `querydata`. Se o plano mudar durante a consulta, o cache fica com o valor antigo e é refeito no pedido seguinte, em vez de ficar marcado como atualizado sem estar.

- **Só grave resposta de sucesso:** `total > 0`, sem coluna faltando e sem `idResumoViagem` repetido. Nenhum erro (404, 502, 504) vai para o cache. Assim o dia de hoje continua dando 404 até a atualização em que ele entra no BI, e a partir daí é consultado normalmente.
  - Consequência: pedir o dia de hoje (ou um dia futuro) consulta o BI **a cada pedido** (~2 s). Na prática o `pax_consolidar` só pede dias que estão em `/dias`.
- **Quando consultar o BI de novo:** quando o `LastRunTime` atual do plano de atualização for **diferente** do `biAtualizadoEm` guardado no cache daquele dia, incluindo quando o guardado é `null`. Compare por igualdade, não por "depois": não se sabe se o `LastRunTime` marca o início ou o fim da atualização. Com "depois", um cache montado no meio de uma atualização nunca seria refeito. Se for igual, responda do cache com `"doCache": true`. A mesma regra vale para o cache de `/dias`.
  - Fique de olho nisso: o operador corrige uma viagem na Cittati num dia e confere no dia seguinte, depois da atualização. O cache **não pode** esconder essa correção.
  - Uma consulta a mais quando o `LastRunTime` muda sem os dados mudarem (ex.: atualização que falhou) é aceitável.
- Para saber a hora da última atualização, consulte o plano de atualização no máximo **uma vez a cada 10 minutos**, contados da **última tentativa, com sucesso ou não**. Guarde em memória o valor e a hora da tentativa. Essa consulta é leve e fica **fora** do lock abaixo; se duas coincidirem, tudo bem. Se ela falhar, use o último valor conhecido. Se nunca houve um, sirva o cache quando ele existir e consulte o BI quando não existir (com `biAtualizadoEm: null`, que será refeito quando o plano voltar a responder).
- **Uma consulta `querydata` por vez** (um lock só para ela). Se dois pedidos chegarem para o mesmo dia sem cache, o segundo espera o primeiro e usa o resultado. A conta é única e compartilhada com a operação, e o limite de uso do BI é desconhecido.
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
- O filtro é **`Data_Sem_Hora`**, um texto `DD/MM/AAAA` entre aspas simples dentro da string. Converta a `data` pedida: `2026-11-25` vira `"Value": "'25/11/2026'"`. Ele é o dia operacional: as viagens de 25/11 vão até ~03:30 de 26/11. Não filtre pela coluna `Data` nem pelos horários.
- **Para `/dias`:** só a coluna `Data_Sem_Hora`, sem `Where`. A resposta vem agrupada: uma linha por dia distinto (o BI manda em ordem, mas o serviço ordena mesmo assim).

### Decodificar

A resposta está em `results[0].result.data.dsr.DS[0]`, e `results[0].result.data.descriptor.Select[]` traz o `Name` de cada coluna devolvida (é por ele que o serviço confere se todas vieram, e na ordem pedida).

**Erros dentro de uma resposta 200.** Uma coluna que não existe **não** tira o `data` da resposta: o `data` vem, e o erro fica em `data.dsr.DataShapes[].odata.error`, com o nome da coluna em `azure:values[].additionalMessages[].AffectedItems` (ex.: `"FT_ViagensBI[colunaQueSumiu]"`). O serviço lê esse campo para devolver `bi_coluna_ausente` com o nome da coluna. Outro erro nesse lugar vira `bi_erro` com o `code` e a mensagem. Se `results[0].result` não tiver `data`, também é `bi_erro`.

**Dois formatos de linha.** Em `DS[0].PH[0].DM0[]`, a primeira linha traz `S`: uma entrada por coluna, com o nome interno (`N`: `G0`, `G1`…) e, nas colunas de texto, o dicionário (`DN`). Depois disso, os valores vêm de um destes jeitos:

| Consulta | Linha | Exemplo |
|---|---|---|
| Várias colunas (`/viagens`) | array `C` com os valores, **omitindo** os marcados nos bitmasks `R` (repete a linha anterior) e `Ø` (nulo) | `{"C": [-1730752193, 2, 1, 1, 1795588800000], "R": 805132158}` |
| Uma coluna só (`/dias`) | chave com o nome interno, **sem** `C` | `{"G0": 3}` |

Nos dois casos, um inteiro numa coluna com `DN` é índice em `ValueDicts[DN]`, e um valor repetido (`R`) já vem decodificado da linha anterior. O decodificador do serviço (`_decodificar` em [`flow_api/server.py`](../flow_api/server.py)) trata os dois formatos e falha com `bi_erro` se sobrar ou faltar valor numa linha. O decodificador da referência do nyx só lê `C`: em `/dias` ele devolveria `null` em todos os dias.

- **Paginação:** se vier `RT`, há mais linhas. Reenvie a consulta com `"Window": { "Count": 30000, "RestartTokens": <RT> }`. **A primeira linha da página nova repete a última da anterior**: descarte-a. Um dia inteiro (~7.400 viagens, 30 colunas) cabe numa página, mas o `RT` é tratado mesmo assim (até 20 páginas).
- Confira se toda coluna pedida veio na resposta e se nenhum `idResumoViagem` se repete. Se não, devolva erro e não grave cache.

Timeout de 60 s no total por chamada ao BI (não só por leitura do socket). Sem novas tentativas automáticas: devolva o erro.

---

## Pronto quando

Rodando no próprio servidor (a CA está em `/etc/nyx-tls/nyx-local-ca.crt`):

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
- dois pedidos simultâneos para um dia sem cache fazem uma consulta só ao BI;
- `/dias` sai em `AAAA-MM-DD`, em ordem crescente e sem repetidos;
- `/viagens?data=<hoje>` dá 404 `dia_sem_dados`, e `/viagens?data=25-11-2026` e `/viagens?data=2026-02-30` dão 400;
- uma coluna inexistente dá 502 `bi_coluna_ausente` com o nome dela;
- `curl -s -X OPTIONS -i .../viagens` dá 204 com os cabeçalhos de CORS;
- o `.env` tem permissão 600 e o login não aparece no `journalctl -u flow-api`;
- `systemctl restart` e um reboot trazem o serviço de volta;
- o nyx continua funcionando (`https://rafaelplan.local/` redireciona para `/login`).

### Conferência de 2026-11-26

Feita pelo serviço instalado, via nginx:

| Item | Resultado |
|---|---|
| `/saude` | `ok: true`, `biAtualizadoEm` 2026-11-26T05:01:35-03:00, `Completed Data Refresh` |
| `/dias` | 23 dias, de 2026-11-03 a 2026-11-25 |
| `/viagens?data=2026-11-25` | 7.413 viagens distintas, contagem por empresa igual à tabela acima, 885 da Rápido realizadas; BI em ~2,8 s |
| Cache | segunda chamada `doCache: true` em ~240 ms, sem consulta ao BI |
| Simultâneos | dois pedidos ao mesmo tempo: uma consulta, o segundo saiu do cache (teste local) |
| Erros | hoje → 404; `25-11-2026` e `2026-02-30` → 400; coluna inexistente → 502 `bi_coluna_ausente` (teste local) |
| CORS | `OPTIONS` → 204 com os cabeçalhos; `Origin: null` recebe `*`; gzip pelo HTTP/2 |
| Acesso | pelo nome e pelo IP `192.168.1.144`; `http://` redireciona para `https://` |
| Log | uma linha por pedido; login, senha e `Basic` não aparecem no journal |
| nyx | `/` → 307 `/login`, `/login` → 200, `/api/` e o download da CA iguais a antes da migração do nginx |

**Falta conferir** (precisa de `sudo` ou de outra máquina):

- permissão do `.env`: `sudo stat -c '%a %U' /etc/flow-api/.env` deve dar `600 flow-api` (a pasta `/etc/flow-api` já está `700 flow-api`);
- `sudo systemctl restart flow-api` e um reboot;
- uma máquina Windows de operador (seção abaixo).

---

## Fora do servidor: máquinas dos operadores

Não é tarefa de quem implementa o serviço, mas sem isso o `pax_consolidar` não alcança o serviço. Testar numa máquina Windows de operador, abrindo no navegador `https://rafaelplan.local/flow-api/cittati/saude`:

1. **Nome.** Se `rafaelplan.local` não resolver (o `.local` depende de mDNS, e o Windows nem sempre resolve), use o IP `192.168.1.144`, que já está no certificado, ou uma entrada no DNS da rede.
2. **Certificado.** Se o navegador reclamar do certificado, a máquina não confia na `Nyx Local CA`. Uma chamada feita pela página falha sem aviso nenhum, então é preciso instalar a CA em "Autoridades de Certificação Raiz Confiáveis" (manual ou por GPO). Vale também para quando os operadores passarem a usar o nyx.
3. **Rede local.** O Chrome/Edge podem pedir permissão para uma página acessar a rede local. Se aparecer o pedido ao rodar o `pax_consolidar`, permita.
