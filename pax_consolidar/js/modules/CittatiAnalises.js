// ============================================================
// CittatiAnalises.js — Análises que só existem com GPS Cittati
//
// Funções puras sobre o Session (sem DOM). A tela fica no Anomalies.js.
//
//   motivos    — omissão sem motivo, realizada com motivo e
//                justificativa "#" sem indício de que a viagem rodou
//   parciais   — viagem com início e sem fim, ou com fim e sem início;
//                duas seguidas no mesmo carro viram "ida quebrada"
//   pontoFinal — viagem fechada num ponto final diferente do da rota
//
// "Indício" de que uma viagem não realizada rodou: ser parcial, fazer
// parte de uma ida quebrada ou ter passageiros do carro previsto na
// janela (mínimo em anomalies.cittati.paxIndicioMin).
// Viagem com motivo "#" (o operador diz que rodou) e com indício: o
// motor concorda, nada a fazer — fica fora das listas.
// ============================================================

const CittatiAnalises = {

    TIPOS: {
        omissao_sem_motivo:     "Omissão sem motivo",
        realizada_com_motivo:   "Realizada com motivo",
        justificativa_suspeita: "Justificativa sem indício",
        inicio_sem_fim:         "Início sem fim",
        fim_sem_inicio:         "Fim sem início",
        ida_quebrada:           "Ida quebrada",
        ponto_alterado:         "Ponto final alterado"
    },

    analisar(session, empresasSet) {
        const viagens = session.viagens.filter(v => v.cittati && empresasSet.has(v.empresa));
        const temPax  = !!session.temBilhetagem;

        const paxPorCarro  = this._paxPorCarro(session);
        const pares        = this._idasQuebradas(viagens);
        const emPar        = new Set(pares.flatMap(([a, b]) => [a.id, b.id]));
        const paxMin       = APP_CONFIG.anomalies.cittati.paxIndicioMin;

        // Passageiros do carro previsto na janela da viagem
        const paxJanela = v => {
            if (!v.veiculo) return 0;
            return (paxPorCarro[v.veiculo] || []).filter(p => p.mHorario >= v.mInicio && p.mHorario <= v.mFim).length;
        };
        const indicio = v => !!v.cittati.parcial || emPar.has(v.id) || (temPax && paxJanela(v) >= paxMin);

        const item = (tipo, v, extra = {}) => ({ tipo, viagem: v, paxJanela: temPax ? paxJanela(v) : null, ...extra });

        // --- Motivos ---
        const motivos = [];
        let justificadasOk = 0;
        for (const v of viagens) {
            const c = v.cittati;
            if (c.realizadaBI) {
                if (c.motivo) motivos.push(item("realizada_com_motivo", v));
                continue;
            }
            if (!c.motivo) {
                motivos.push(item("omissao_sem_motivo", v, { indicio: indicio(v) }));
            } else if (c.motivoRealizada) {
                if (indicio(v)) justificadasOk++;
                else motivos.push(item("justificativa_suspeita", v));
            }
            // Outro motivo = omissão justificada. Passageiros nela aparecem
            // em "Omissões com passageiro".
        }

        // --- Parciais (fora as justificadas com "#": o motor concorda) ---
        const parciais = [];
        for (const [a, b] of pares) {
            if (a.cittati.motivoRealizada && b.cittati.motivoRealizada) continue;
            parciais.push(item("ida_quebrada", a, { par: b, parte: 1 }));
            parciais.push(item("ida_quebrada", b, { par: a, parte: 2 }));
        }
        for (const v of viagens) {
            if (!v.cittati.parcial || emPar.has(v.id) || v.cittati.motivoRealizada) continue;
            parciais.push(item(v.cittati.parcial, v));
        }

        // --- Ponto final alterado ---
        const pontoFinal = viagens
            .filter(v => v.cittati.pontoAlterado)
            .map(v => item("ponto_alterado", v));

        const porHorario = (a, b) => a.viagem.empresa.localeCompare(b.viagem.empresa)
            || a.viagem.linha_base.localeCompare(b.viagem.linha_base)
            || a.viagem.mInicio - b.viagem.mInicio;
        motivos.sort(porHorario);
        pontoFinal.sort(porHorario);
        // parciais: pares ficam juntos (1/2 seguido de 2/2)
        parciais.sort((x, y) => {
            const ax = x.par && x.parte === 2 ? x.par : x.viagem;
            const ay = y.par && y.parte === 2 ? y.par : y.viagem;
            return porHorario({ viagem: ax }, { viagem: ay }) || (x.parte || 0) - (y.parte || 0);
        });

        return { motivos, parciais, pontoFinal, justificadasOk, semBilhetagem: !temPax };
    },

    // Duas viagens encadeadas do mesmo carro e da mesma linha: a primeira
    // com início e sem fim, a seguinte com fim e sem início — o GPS perdeu
    // a passagem no ponto final entre as duas. Encadeada: a segunda está
    // prevista para começar até idaQuebradaGapMin depois do fim previsto
    // da primeira.
    _idasQuebradas(viagens) {
        const gapMax = APP_CONFIG.anomalies.cittati.idaQuebradaGapMin;
        const porCarro = {};
        for (const v of viagens) {
            if (!v.veiculo) continue;
            (porCarro[v.veiculo] = porCarro[v.veiculo] || []).push(v);
        }
        const pares = [];
        for (const lista of Object.values(porCarro)) {
            lista.sort((a, b) => a.mInicio - b.mInicio);
            for (let i = 0; i + 1 < lista.length; i++) {
                const a = lista[i], b = lista[i + 1];
                const gap = b.cittati.mPrevInicio - a.cittati.mPrevFim;
                if (a.cittati.parcial === "inicio_sem_fim" && b.cittati.parcial === "fim_sem_inicio"
                    && a.linha_base === b.linha_base && gap >= -gapMax && gap <= gapMax) {
                    pares.push([a, b]);
                    i++;
                }
            }
        }
        return pares;
    },

    // Passageiros por carro que ainda podem pertencer a outra viagem:
    // não atribuídos, ou atribuídos por tolerância/sugestão/manual.
    // Os de match direto (etapa A) estavam dentro da janela real de outra viagem.
    _paxPorCarro(session) {
        const ignorados = new Set((session.paxIgnorados || []).map(p => p.id));
        const mapa = {};
        for (const p of session.passageiros || []) {
            if (!p.veiculo || ignorados.has(p.id)) continue;
            if (p.assigned && p.atribuicaoMetodo === "etapa_a") continue;
            (mapa[p.veiculo] = mapa[p.veiculo] || []).push(p);
        }
        return mapa;
    }
};
