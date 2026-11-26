// ============================================================
// Cittati.js — Fonte de GPS Cittati (BI)
//
// Responsabilidades:
//   1. Conferir o serviço e buscar as viagens de um dia no serviço
//      flow-api (docs/cittati_bi_servico.md), ou ler o mesmo JSON salvo
//      em arquivo.
//   2. Converter cada viagem do BI no mesmo formato de linha que o
//      DataNormalizer entrega para o GPS Sonda — o Engine não precisa
//      saber de onde veio a viagem.
//   3. Calcular o que só faz sentido olhando o dia inteiro: ponto final
//      alterado (comparado com as outras viagens da mesma rota).
//
// Os dados da Cittati ficam em viagem.cittati (ver _converter).
// Não conhece a UI nem o Engine.
// ============================================================

const Cittati = {

    // Colunas que o JSON precisa ter (mesma lista do serviço)
    COLUNAS: [
        "idResumoViagem", "Data_Sem_Hora", "nomeEmpresa", "numeroLinha", "Sentido", "nomeAtendimento",
        "posicao", "prefixo", "matriculaMotorista",
        "Prev_Inicio_sem_segundos", "Real_Inicio_sem_segundos", "Prev_Fim_sem_segundos", "Real_Fim_sem_segundos",
        "nomePontoTS", "viagemRealizada", "viagemExtra", "problemaHardware", "motivo"
    ],


    // ----------------------------------------------------------
    // Serviço
    // ----------------------------------------------------------

    // { ok, biAtualizadoEm, biStatus } — ok:false quando o BI não respondeu
    async saude() {
        return this._get("/saude");
    },

    // data: "AAAA-MM-DD"
    async viagensDoDia(data) {
        return this._get(`/viagens?data=${encodeURIComponent(data)}`);
    },

    async _get(caminho) {
        const base = APP_CONFIG.fontes.cittati.servico.replace(/\/+$/, "");
        let resp;
        try {
            resp = await fetch(base + caminho);
        } catch {
            throw new Error(
                `Serviço Cittati inacessível (${base}).\n` +
                `Verifique se o servidor está no ar e se este computador confia no certificado dele.`
            );
        }
        let corpo = null;
        try { corpo = await resp.json(); } catch { /* corpo não é JSON */ }
        if (!resp.ok) {
            const err = new Error(corpo?.detalhe || corpo?.erro || `Serviço Cittati respondeu ${resp.status}.`);
            err.codigo = corpo?.erro || null;   // ex.: "dia_sem_dados"
            throw err;
        }
        return corpo;
    },


    // ----------------------------------------------------------
    // Validação do JSON (do serviço ou de arquivo)
    // ----------------------------------------------------------

    ehRespostaCittati(obj) {
        return !!obj && Array.isArray(obj.viagens) && typeof obj.data === "string";
    },

    validar(resposta) {
        if (!this.ehRespostaCittati(resposta)) {
            throw new Error("Arquivo não é uma resposta do serviço Cittati (faltam \"data\" e \"viagens\").");
        }
        if (resposta.viagens.length === 0) {
            throw new Error(`Nenhuma viagem da Cittati em ${resposta.data}.`);
        }
        const amostra = resposta.viagens[0];
        const faltando = this.COLUNAS.filter(c => !(c in amostra));
        if (faltando.length) {
            throw new Error(`Viagens da Cittati sem as colunas: ${faltando.join(", ")}.`);
        }
    },


    // ----------------------------------------------------------
    // Conversão: resposta do serviço → linhas normalizadas de GPS
    // Retorna linhas no formato do DataNormalizer + campos extras:
    //   mJanelaInicio / mJanelaFim — minutos na linha do tempo do dia
    //     operacional (madrugada seguinte em 1440+), já resolvidos aqui
    //   cittati — dados da Cittati (motivo, rota, parcial, ponto final...)
    // ----------------------------------------------------------

    paraGps(resposta) {
        this.validar(resposta);

        const cfg     = APP_CONFIG.fontes.cittati;
        const motivos = new Set(cfg.motivosRealizada);
        const linhas  = resposta.viagens.map(b => this._converter(b, cfg, motivos));

        this._marcarPontoFinal(linhas, cfg.pontoFinal.participacaoMaximaPct);
        return linhas;
    },

    _converter(b, cfg, motivos) {
        const texto = v => (v === null || v === undefined ? "" : String(v).trim());

        const empresaBI = texto(b.nomeEmpresa);
        const empresa   = cfg.normalizacao.empresa[empresaBI] || empresaBI;
        const linhaBase = texto(b.numeroLinha);
        const sentido   = texto(b.Sentido).toUpperCase() || "UNICO";

        const prevIni = texto(b.Prev_Inicio_sem_segundos);
        const prevFim = texto(b.Prev_Fim_sem_segundos);
        const realIni = texto(b.Real_Inicio_sem_segundos);
        const realFim = texto(b.Real_Fim_sem_segundos);

        const realizada = texto(b.viagemRealizada).toLowerCase() === "sim";
        const extra     = texto(b.viagemExtra).toLowerCase() === "sim";
        const motivo    = texto(b.motivo);

        // Parcial: não realizada, mas com UM dos horários reais
        const parcial = realizada ? null
                      : (realIni && !realFim) ? "inicio_sem_fim"
                      : (!realIni && realFim) ? "fim_sem_inicio"
                      : null;

        // Janela usada pelo Engine para indexar a viagem no tempo:
        //   realizada → real; sem horário real → prevista;
        //   parcial → o lado real + a duração prevista para o outro lado
        const dia0     = Cittati._diaIndex(b.Data_Sem_Hora);
        const m        = s => Cittati._minRelativo(s, dia0);
        const duracao  = Math.max(0, (m(prevFim) ?? 0) - (m(prevIni) ?? 0));
        let mJanelaInicio, mJanelaFim;
        if (realizada && realIni && realFim)  { mJanelaInicio = m(realIni);           mJanelaFim = m(realFim); }
        else if (parcial === "inicio_sem_fim") { mJanelaInicio = m(realIni);           mJanelaFim = mJanelaInicio + duracao; }
        else if (parcial === "fim_sem_inicio") { mJanelaFim    = m(realFim);           mJanelaInicio = mJanelaFim - duracao; }
        else                                   { mJanelaInicio = m(prevIni);           mJanelaFim = m(prevFim); }
        if (mJanelaFim < mJanelaInicio) mJanelaFim = mJanelaInicio;

        // Status no código do Engine (settings → engine.status)
        const st = APP_CONFIG.engine.status;
        const statusViagem = !realizada ? st.omissao.value : extra ? st.extra.value : st.produtivo.value;

        return {
            // Campos do DataNormalizer (mesmo contrato do GPS Sonda)
            data:             texto(b.Data_Sem_Hora),
            linha:            `${linhaBase} - ${sentido}`,
            linha_raw:        linhaBase,
            linha_base:       linhaBase,
            sentido,
            veiculo:          texto(b.prefixo),
            motorista:        texto(b.matriculaMotorista),
            partidaPlanejada: Cittati._hora(prevIni),
            chegadaPlanejada: Cittati._hora(prevFim),
            partidaReal:      Cittati._hora(realIni),
            chegadaReal:      Cittati._hora(realFim),
            statusViagem,
            viagemEditada:    "",            // preenchido em _marcarPontoFinal
            tabela:           texto(b.posicao),
            empresa,

            // Janela já resolvida na linha do tempo do dia operacional
            mJanelaInicio,
            mJanelaFim,

            cittati: {
                id:               b.idResumoViagem,
                empresaBI,
                rota:             texto(b.nomeAtendimento),
                realizadaBI:      realizada,
                parcial,
                motivo,
                motivoRealizada:  motivos.has(motivo),   // um dos 4 "#" — operador diz que rodou
                problemaHardware: Number(b.problemaHardware) === 1,
                pontoFinal:       texto(b.nomePontoTS),
                pontoFinalRota:   "",                    // ponto final mais comum da rota
                pontoAlterado:    false,
                mPrevInicio:      m(prevIni),            // minutos na linha do tempo do dia
                mPrevFim:         m(prevFim),
                prevInicio:       prevIni,
                prevFim,
                realInicio:       realIni,
                realFim
            }
        };
    },

    // ----------------------------------------------------------
    // Ponto final alterado
    // Na Cittati o operador pode fechar a viagem num ponto anterior ao
    // final. Agrupa por empresa + linha + sentido + rota (nomeAtendimento:
    // linhas com várias rotas têm um nome por rota) e marca a viagem cujo
    // ponto final é minoria na rota (participação <= limite).
    // ----------------------------------------------------------
    _marcarPontoFinal(linhas, limitePct) {
        const grupos = {};
        for (const l of linhas) {
            if (!l.cittati.pontoFinal) continue;
            const k = [l.empresa, l.linha_base, l.sentido, l.cittati.rota.toLowerCase()].join("|");
            (grupos[k] = grupos[k] || []).push(l);
        }

        for (const grupo of Object.values(grupos)) {
            const cont = {};
            for (const l of grupo) cont[l.cittati.pontoFinal] = (cont[l.cittati.pontoFinal] || 0) + 1;
            const [principal] = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];

            for (const l of grupo) {
                l.cittati.pontoFinalRota = principal;
                const p = l.cittati.pontoFinal;
                if (p !== principal && (cont[p] / grupo.length) * 100 <= limitePct) {
                    l.cittati.pontoAlterado = true;
                    l.viagemEditada = "Sim";   // aparece como "editada" nos filtros de viagem
                }
            }
        }
    },


    // ----------------------------------------------------------
    // Auxiliares
    // ----------------------------------------------------------

    // "25/11/2026 23:44" → "23:44"
    _hora(s) {
        const m = String(s || "").match(/(\d{2}:\d{2})/);
        return m ? m[1] : "";
    },

    // Dias desde 1970 a partir de "DD/MM/AAAA..."
    _diaIndex(s) {
        const m = String(s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000 : null;
    },

    // Minutos de "DD/MM/AAAA HH:MM" relativos à meia-noite do dia operacional
    _minRelativo(s, dia0) {
        const dia = Cittati._diaIndex(s);
        const hm  = String(s || "").match(/(\d{2}):(\d{2})/);
        if (dia === null || !hm || dia0 === null) return null;
        return (dia - dia0) * 1440 + (+hm[1]) * 60 + (+hm[2]);
    },

    // "2026-11-25" ↔ "25/11/2026"
    isoParaBR(iso) {
        const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
    }
};
