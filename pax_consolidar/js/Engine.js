// ============================================================
// Engine.js — Motor de conciliação do TransSync Pro
//
// Responsabilidades:
//   1. Receber os dados brutos normalizados (GPS + Bilhetagem)
//   2. Construir o Session — objeto central com todos os dados organizados
//   3. Executar as etapas de conciliação (A, B, C)
//   4. Devolver o Session populado para consumo de qualquer módulo
//
// O Engine não toca na UI. Não altera AppState diretamente.
// Quem chama o Engine é o main.js, que recebe o Session e o armazena.
// ============================================================

class Engine {

    // ----------------------------------------------------------
    // Construtor
    // rawGps e rawPax são arrays de linhas já normalizadas pelo DataNormalizer
    // Ambos são opcionais — o Engine opera com o que receber
    // ----------------------------------------------------------
    constructor(rawGps = [], rawPax = []) {
        this._rawGps = rawGps;
        this._rawPax = rawPax;
    }


    // ----------------------------------------------------------
    // PONTO DE ENTRADA PÚBLICO
    // Retorna o Session completo após todas as etapas
    // ----------------------------------------------------------
    process(empresasConciliacao = null) {
        const session = this._buildSession(empresasConciliacao);
        this._tempoContinuo = true;

        // Define o escopo ANTES das etapas para que _etapaC filtre corretamente.
        // Sem isso, _etapaC processa todos os passageiros (conciliadas = []) e pode
        // gerar candidatos para empresas fora do escopo, tornando o processamento lento.
        session.empresasConciliadas = empresasConciliacao
            ? [...empresasConciliacao]
            : [...new Set(session.viagens.map(v => v.empresa).filter(Boolean))];

        if (session.temGps && session.temBilhetagem) {
            this._etapaA(session);
            this._etapaB(session);
            this._etapaC(session);
        }
        this._calcularResumo(session);
        return session;
    }


    // ==========================================================
    // CONSTRUÇÃO DO SESSION
    // ==========================================================

    _buildSession(empresasConciliacao = null) {
        const cfg = APP_CONFIG;

        // --- Viagens (GPS) ---
        const statusAtivos = Object.values(cfg.engine.status)
            .filter(s => !s.ignorar)
            .map(s => s.value);

        // Dia operacional (coluna Data do GPS) — referência da linha do tempo
        const dataOperacao = this._rawGps[0]?.data || "";
        this._dia0 = Engine._diaIndex(dataOperacao);

        const viagens = this._rawGps
            .filter(r => statusAtivos.includes(String(r.statusViagem)))
            .map((r, idx) => this._buildViagem(r, idx));

        // Viagens da madrugada que encerram a noite do dia → 1440+
        this._ajustarMadrugadaGps(viagens);

        // --- Passageiros (Bilhetagem) ---
        // Linhas ignoradas são excluídas da conciliação mas preservadas no modelo
        const linhasIgnoradas = new Set(
            (cfg.fontes.bilhetagem.linhasIgnoradas || []).map(l => String(l).trim())
        );

        const passageiros = this._rawPax.map((r, idx) => this._buildPassageiro(r, idx));

        const [paxConciliaveis, paxIgnorados] = this._partition(
            passageiros,
            p => !linhasIgnoradas.has(p.linha_consolidada)
        );

        // --- Índices para performance ---
        // paxPorVeiculo considera apenas as empresas selecionadas para conciliação
        const empresasSet       = empresasConciliacao ? new Set(empresasConciliacao) : null;
        const paxParaConciliar  = empresasSet
            ? paxConciliaveis.filter(p => empresasSet.has(p.empresa))
            : paxConciliaveis;

        const viagensPorVeiculo  = this._groupBy(viagens,          'veiculo');
        const paxPorVeiculo      = this._groupBy(paxParaConciliar,  'veiculo');

        // Agrupa viagens por tabela para uso no Anomalies (identificar carro de omissões)
        const viagensPorTabela   = this._groupBy(viagens, 'tabela');

        return {
            // Dados
            viagens,
            passageiros,          // todos — incluindo ignorados e não conciliáveis
            paxIgnorados,         // linhas sem correspondência no GPS (preservados para outros usos)

            // Data de operação extraída do primeiro registro GPS (formato bruto do arquivo)
            dataOperacao,

            // Linha do tempo contínua do dia operacional: madrugada seguinte em 1440+
            // (sessões salvas antes desta versão não têm a flag e usam _ajustarPernoite)
            tempoContinuo: true,

            // Índices internos (usados pelo Engine e módulos — não exportados)
            _idx: { viagensPorVeiculo, paxPorVeiculo, viagensPorTabela },

            // Flags de presença
            temGps:        viagens.length > 0,
            temBilhetagem: passageiros.length > 0,

            // Empresas que já passaram pelo engine (define o escopo das exceções)
            empresasConciliadas: [],

            // Resultado da conciliação — populado pelas etapas
            resumo: null,

            // Sugestões da etapa C — aguardando confirmação do usuário
            sugestoes: []
        };
    }

    _buildViagem(r, idx) {
        const cfg    = APP_CONFIG.engine;
        const status    = String(r.statusViagem);
        const statusDef = Object.values(cfg.status).find(s => s.value === status) || {};

        const isOmissao = statusDef.isOmissao === true;
        const isExtra   = statusDef.isExtra   === true;
        const editadaRaw = String(r.viagemEditada || "").trim().toLowerCase();
        const isEditada  = editadaRaw === "sim" || editadaRaw === "s" || editadaRaw === "1";

        // Omissões não têm horário real — usa planejado para fins de indexação temporal
        const hIni = isOmissao ? r.partidaPlanejada  : r.partidaReal;
        const hFim = isOmissao ? r.chegadaPlanejada  : r.chegadaReal;

        const mInicio = this._toMin(hIni) ?? 0;
        let   mFim    = this._toMin(hFim) ?? mInicio;

        // Virada de dia: chegada menor que partida = passou da meia-noite
        // (inclui chegada 00:00:xx, que antes era lida como "sem horário")
        const pernoite = mFim < mInicio;
        if (pernoite) mFim += 1440;

        return {
            // Identificação
            id:               `trip_${idx}`,
            veiculo:          r.veiculo          || "",
            linha:            r.linha            || "",
            linha_base:       r.linha_base       || r.linha || "",
            sentido:          r.sentido          || "UNICO",
            empresa:          r.empresa          || "",
            tabela:           r.tabela           || "",
            motorista:        r.motorista        || "",

            // Horários (strings originais preservadas para exibição)
            partidaPlanejada:  r.partidaPlanejada  || "",
            chegadaPlanejada:  r.chegadaPlanejada  || "",
            partidaReal:       r.partidaReal       || "",
            chegadaReal:       r.chegadaReal       || "",

            // Horários em minutos (usados pelo Engine)
            mInicio,
            mFim,
            pernoite,

            // Flags de estado
            statusOriginal:      status,
            isOmissao,
            isExtra,
            isEditada,
            convertidaDeOmissao: false,  // true quando omissão recebe pax manualmente
            editadaManualmente:  false,  // true quando usuário altera via UI

            // Conciliação — populado pelas etapas A/B ou confirmação do usuário
            paxEfetivos: []
        };
    }

    _buildPassageiro(r, idx) {
        return {
            // Identificação
            id:      `pax_${idx}`,
            veiculo:            r.veiculo           || "",
            linha_raw:          r.linha_raw          || r.linha || "",
            linha_consolidada:  r.linha_consolidada  || r.linha || "",
            empresa: r.empresa  || "",
            horario: r.horario  || "",
            tipo:    r.tipo     || "",
            tarifa:  r.tarifa   || "",

            // Horário em minutos na linha do tempo do dia operacional
            // (madrugada do dia seguinte → 1440+)
            mHorario: this._minOperacional(r.horario),

            // Conciliação
            assigned:          false,
            tripId:            null,
            atribuicaoMetodo:  null,  // "etapa_a" | "etapa_b" | "etapa_c" | "manual"
            deltaMinutos:      null,  // distância em minutos até o início da viagem atribuída
            sentido:           null   // preenchido na atribuição com o sentido da viagem
        };
    }


    // ==========================================================
    // ETAPA A — Match direto
    // Critério duro: veiculo + linha + passageiro dentro de [mInicio, mFim]
    // Sem tolerância.
    // ==========================================================

    _etapaA(session) {
        const { _idx } = session;

        for (const veiculo in _idx.paxPorVeiculo) {
            const passageiros = _idx.paxPorVeiculo[veiculo];
            const viagens     = this._viagensConciliaveis(_idx.viagensPorVeiculo[veiculo] || []);

            for (const p of passageiros) {
                if (p.assigned) continue;

                for (const v of viagens) {
                    if (p.linha_consolidada !== v.linha_base) continue;
                    const pMin = this._ajustarPernoite(p.mHorario, v);
                    if (pMin >= v.mInicio && pMin <= v.mFim) {
                        this._atribuir(p, v, "etapa_a");
                        break;
                    }
                }
            }
        }
    }


    // ==========================================================
    // ETAPA B — Match por tolerância
    // Para passageiros fora da janela exata mas dentro das margens do settings.
    // ==========================================================

    _etapaB(session) {
        const { _idx } = session;
        const tolCfg = APP_CONFIG.engine.tolerancias;

        for (const veiculo in _idx.paxPorVeiculo) {
            const passageiros = _idx.paxPorVeiculo[veiculo];
            const viagens     = this._viagensConciliaveis(_idx.viagensPorVeiculo[veiculo] || []);

            for (const p of passageiros) {
                if (p.assigned) continue;

                // Ordena candidatos por proximidade ao passageiro (menor delta primeiro)
                // Resolve empate quando o passageiro cabe em duas janelas sobrepostas
                const candidatos = viagens
                    .filter(v => p.linha_consolidada === v.linha_base)
                    .map(v => {
                        const pMin = this._ajustarPernoite(p.mHorario, v);
                        const tol  = tolCfg[v.sentido] || tolCfg["UNICO"];
                        const dentro = pMin >= (v.mInicio - tol.inicioMin)
                                    && pMin <= (v.mFim    + tol.fimMin);
                        const delta  = Math.abs(pMin - v.mInicio);
                        return { v, dentro, delta };
                    })
                    .filter(c => c.dentro)
                    .sort((a, b) => a.delta - b.delta);

                if (candidatos.length > 0) {
                    const melhor = candidatos[0];
                    this._atribuir(p, melhor.v, "etapa_b", melhor.delta);
                }
            }
        }
    }


    // ==========================================================
    // ETAPA C — Análise de remanescentes
    // Para cada passageiro não atribuído, busca viagens da mesma empresa
    // dentro da janela gapLongoMax e pontua cada candidata.
    // A melhor pontuação acima de confiancaMinima vira sugestão.
    // Nenhuma atribuição automática — o usuário confirma.
    // ==========================================================

    _etapaC(session) {
        const cfg     = APP_CONFIG.engine;
        const pesos   = cfg.pesos;
        const confMin = cfg.confiancaMinima;

        const ignoradosIds = new Set((session.paxIgnorados || []).map(p => p.id));
        const conciliadas  = new Set(session.empresasConciliadas || []);

        const unassigned = session.passageiros.filter(p =>
            !p.assigned &&
            !ignoradosIds.has(p.id) &&
            (conciliadas.size === 0 || conciliadas.has(p.empresa))
        );

        // Índice de viagens por empresa (inclui omissões — podem receber pax manualmente)
        const viagensPorEmpresa = {};
        for (const v of session.viagens) {
            (viagensPorEmpresa[v.empresa] = viagensPorEmpresa[v.empresa] || []).push(v);
        }

        const sugestoes = [];

        for (const p of unassigned) {
            const pMin = p.mHorario;

            // Candidatas: viagens da mesma empresa dentro da janela longa
            const candidatas = (viagensPorEmpresa[p.empresa] || []).filter(v => {
                const pMinAjust = this._ajustarPernoite(pMin, v);
                return pMinAjust >= (v.mInicio - cfg.gapLongoMax)
                    && pMinAjust <= (v.mFim    + cfg.gapLongoMax);
            });

            let melhorViagem     = null;
            let melhorScore      = -1;
            let melhorCriterios  = null;

            for (const v of candidatas) {
                const pMinAjust = this._ajustarPernoite(pMin, v);

                const pts = {
                    veiculo:  p.veiculo === v.veiculo           ? pesos.matchVeiculo   : 0,
                    linha:    p.linha_consolidada === v.linha_base ? pesos.matchLinha     : 0,
                    sentido:  (p.sentido && p.sentido === v.sentido) ? pesos.matchSentido : 0,
                    gapCurto: 0,
                    gapLongo: 0
                };

                // Proximidade temporal: gapCurto tem mais peso que gapLongo
                if (pMinAjust >= (v.mInicio - cfg.gapCurtoMax) && pMinAjust <= (v.mFim + cfg.gapCurtoMax)) {
                    pts.gapCurto = pesos.dentroGapCurto;
                } else {
                    pts.gapLongo = pesos.dentroGapLongo;
                }

                const scoreRaw = pts.veiculo + pts.linha + pts.sentido + pts.gapCurto + pts.gapLongo;
                const score    = Math.min(scoreRaw, 100);

                if (score > melhorScore) {
                    melhorScore     = score;
                    melhorViagem    = v;
                    melhorCriterios = { ...pts, scoreRaw };
                }
            }

            if (melhorViagem && melhorScore >= confMin) {
                sugestoes.push(this._buildSugestao(p, melhorViagem, melhorScore, melhorCriterios));
            }
        }

        // Acumula (modo incremental preserva sugestões de outras empresas já processadas)
        session.sugestoes = [...(session.sugestoes || []), ...sugestoes];
        session.sugestoes.sort((a, b) => b.confianca - a.confianca || a.mHorario - b.mHorario);
    }

    _buildSugestao(pax, viagem, confianca, criterios) {
        // Motivo derivado dos critérios que contribuíram
        let motivo;
        if      (criterios.veiculo > 0 && criterios.linha > 0) motivo = criterios.gapCurto > 0 ? "gap_curto" : "gap_longo";
        else if (criterios.veiculo > 0)                         motivo = "linha_divergente";
        else if (criterios.linha   > 0)                         motivo = "veiculo_divergente";
        else                                                     motivo = criterios.gapCurto > 0 ? "gap_curto" : "gap_longo";

        return {
            paxId:      pax.id,
            tripId:     viagem.id,
            motivo,
            confianca,
            criterios,  // { veiculo, linha, sentido, gapCurto, gapLongo, scoreRaw } — limpo ao alocar
            confirmada: false,
            mHorario:   pax.mHorario,
            pax,        // referência (stripped on export)
            viagem      // referência (stripped on export)
        };
    }


    // ==========================================================
    // RESUMO
    // Calculado após todas as etapas — usado pelo dashboard e exportação
    // ==========================================================

    _calcularResumo(session) {
        const { viagens, passageiros, paxIgnorados, sugestoes } = session;

        // Restringe ao escopo das empresas conciliadas
        const conciliadas  = new Set(session.empresasConciliadas || []);
        const paxScope     = conciliadas.size > 0 ? passageiros.filter(p => conciliadas.has(p.empresa)) : passageiros;
        const viagensScope = conciliadas.size > 0 ? viagens.filter(v => conciliadas.has(v.empresa))     : viagens;

        const ignoradosIds  = new Set(paxIgnorados.map(p => p.id));
        const totalPax      = paxScope.length;
        const atribuidos    = paxScope.filter(p => p.assigned).length;
        const naoAtribuidos = paxScope.filter(p => !p.assigned && !ignoradosIds.has(p.id)).length;
        const ignorados     = paxScope.filter(p => ignoradosIds.has(p.id)).length;

        const totalViagens  = viagensScope.length;
        const omissoes      = viagensScope.filter(v => v.isOmissao).length;
        const extras        = viagensScope.filter(v => v.isExtra).length;
        const editadas      = viagensScope.filter(v => v.isEditada).length;

        const sugeridosC     = sugestoes.length;
        const autoSelecionaveis = sugestoes.filter(
            s => s.confianca >= APP_CONFIG.ui.confiancaAutoSelecionavel
        ).length;

        // Passageiros sem atribuição E sem nenhuma sugestão pendente —
        // estes exigem intervenção manual (etapa 4)
        const paxComSugestao     = new Set(sugestoes.map(s => s.paxId));
        const excecoesSemSugestao = paxScope.filter(
            p => !p.assigned && !ignoradosIds.has(p.id) && !paxComSugestao.has(p.id)
        ).length;

        session.resumo = {
            totalPax,
            atribuidos,
            naoAtribuidos,
            ignorados,
            totalViagens,
            omissoes,
            extras,
            editadas,
            sugeridosC,
            autoSelecionaveis,
            excecoesSemSugestao,
            taxaConciliacao: totalPax > 0
                ? Math.round((atribuidos / (totalPax - ignorados)) * 100)
                : 0
        };
    }


    // ==========================================================
    // CONFIRMAÇÃO DE SUGESTÕES (etapa C)
    // Chamado pela UI quando o usuário confirma uma ou mais sugestões
    // Retorna o session atualizado
    // ==========================================================

    static confirmarSugestoes(session, sugestaoIds) {
        const ids = new Set(sugestaoIds);
        const omissoesConvertidas = new Set();

        for (const s of session.sugestoes) {
            if (!ids.has(s.paxId)) continue;
            s.confirmada = true;

            const pax    = session.passageiros.find(p => p.id === s.paxId);
            const viagem = session.viagens.find(v => v.id === s.tripId);
            if (!pax || !viagem) continue;

            // Atribuição
            pax.assigned          = true;
            pax.tripId            = viagem.id;
            pax.atribuicaoMetodo  = "etapa_c";
            pax.linha_consolidada = viagem.linha_base;
            pax.sentido           = viagem.sentido || "UNICO";
            viagem.paxEfetivos.push(pax.id);

            // Se a viagem era omissão, converte para produtiva
            if (viagem.isOmissao) {
                viagem.isOmissao           = false;
                viagem.convertidaDeOmissao = true;
                viagem.editadaManualmente  = true;
                viagem.partidaReal         = viagem.partidaPlanejada;
                viagem.chegadaReal         = viagem.chegadaPlanejada;
                omissoesConvertidas.add(viagem.id);
            }
        }

        // Determina o veículo mais frequente entre todos os passageiros atribuídos
        for (const tripId of omissoesConvertidas) {
            const viagem = session.viagens.find(v => v.id === tripId);
            if (viagem) viagem.veiculo = Engine._veiculoMaisFrequente(session, viagem.paxEfetivos);
        }

        // Remove sugestões confirmadas da lista de pendentes
        session.sugestoes = session.sugestoes.filter(s => !s.confirmada);

        // Recalcula resumo
        const engine = new Engine();
        engine._calcularResumo(session);

        return session;
    }


    // ==========================================================
    // ATRIBUIÇÃO MANUAL (UI — passageiro arrastado para viagem)
    // Chamado pela UI diretamente, fora do fluxo de etapas
    // ==========================================================

    static atribuirManualmente(session, paxIds, tripId) {
        const viagem = session.viagens.find(v => v.id === tripId);
        if (!viagem) return session;

        const eraOmissao = viagem.isOmissao;

        for (const paxId of paxIds) {
            const pax = session.passageiros.find(p => p.id === paxId);
            if (!pax) continue;

            // Remove de viagem anterior se já estava atribuído
            if (pax.assigned && pax.tripId) {
                const anterior = session.viagens.find(v => v.id === pax.tripId);
                if (anterior) {
                    anterior.paxEfetivos = anterior.paxEfetivos.filter(id => id !== pax.id);
                }
            }

            pax.assigned          = true;
            pax.tripId            = viagem.id;
            pax.atribuicaoMetodo  = "manual";
            pax.linha_consolidada = viagem.linha_base;
            pax.sentido           = viagem.sentido || "UNICO";
            viagem.paxEfetivos.push(pax.id);

            // Converte omissão se necessário
            if (viagem.isOmissao) {
                viagem.isOmissao           = false;
                viagem.convertidaDeOmissao = true;
                viagem.editadaManualmente  = true;
                viagem.partidaReal         = viagem.partidaPlanejada;
                viagem.chegadaReal         = viagem.chegadaPlanejada;
            }
        }

        // Determina o veículo mais frequente entre todos os passageiros atribuídos
        if (eraOmissao) {
            viagem.veiculo = Engine._veiculoMaisFrequente(session, viagem.paxEfetivos);
        }

        // Remove sugestões pendentes dos passageiros que acabaram de ser atribuídos
        const idsAtribuidos = new Set(paxIds);
        session.sugestoes = session.sugestoes.filter(s => !idsAtribuidos.has(s.paxId));

        const engine = new Engine();
        engine._calcularResumo(session);

        return session;
    }


    // ==========================================================
    // CONCILIAÇÃO INCREMENTAL (pós-import)
    // Processa apenas empresas selecionadas, preservando tudo
    // que já foi conciliado nas demais.
    // ==========================================================

    static conciliarIncremental(session, empresasConciliacao) {
        const empresasSet = new Set(empresasConciliacao);
        const engine = new Engine();
        engine._tempoContinuo = session.tempoContinuo === true;

        // Re-aplica normalizações do settings atual sobre os dados do session
        // Seguro: valores canônicos não são chaves no mapeamento, então é idempotente.
        // Permite que mapeamentos adicionados após a última rodada sejam aproveitados.
        Engine.reNormalizarSession(session);

        // Remove sugestões pendentes das empresas selecionadas — serão regeneradas
        session.sugestoes = (session.sugestoes || []).filter(s => {
            const pax = session.passageiros.find(p => p.id === s.paxId);
            return !pax || !empresasSet.has(pax.empresa);
        });

        // Reconstrói _idx: todas as viagens (contexto completo), pax filtrado
        const paxParaConciliar = session.passageiros.filter(
            p => !p.assigned && empresasSet.has(p.empresa)
        );
        session._idx = {
            viagensPorVeiculo: engine._groupBy(session.viagens,       'veiculo'),
            paxPorVeiculo:     engine._groupBy(paxParaConciliar,      'veiculo'),
            viagensPorTabela:  engine._groupBy(session.viagens,       'tabela')
        };

        // Define escopo antes das etapas (mesma razão do process())
        session.empresasConciliadas = [...empresasConciliacao];

        engine._etapaA(session);
        engine._etapaB(session);
        engine._etapaC(session);

        engine._calcularResumo(session);

        return session;
    }


    // ==========================================================
    // RE-NORMALIZAÇÃO DE SESSION EXISTENTE
    // Re-aplica os mapeamentos do settings atual sobre viagens e
    // passageiros já no session. Útil quando normalizacao.linha ou
    // normalizacao.empresa é atualizado após a primeira rodada.
    // ==========================================================

    static reNormalizarSession(session) {
        const cfgGps = APP_CONFIG.fontes.gps.normalizacao;
        const cfgPax = APP_CONFIG.fontes.bilhetagem.normalizacao;

        const aplicar = (valor, mapa) => mapa?.[valor] || valor;

        const derivarLinha = (obj, novaLinha) => {
            obj.linha = novaLinha;
            if (novaLinha.includes(' - ')) {
                const [base, sentido] = novaLinha.split(' - ');
                obj.linha_base = base.trim();
                obj.sentido    = sentido.trim().toUpperCase();
            } else {
                obj.linha_base = novaLinha;
            }
        };

        for (const v of session.viagens) {
            v.empresa = aplicar(v.empresa, cfgGps.empresa);
            v.veiculo = aplicar(v.veiculo, cfgGps.veiculo);
            const linhaNorm = aplicar(v.linha, cfgGps.linha);
            if (linhaNorm !== v.linha) derivarLinha(v, linhaNorm);
        }

        for (const p of session.passageiros) {
            p.empresa = aplicar(p.empresa, cfgPax.empresa);
            p.veiculo = aplicar(p.veiculo, cfgPax.veiculo);
            const linhaNorm = aplicar(p.linha_raw, cfgPax.linha);
            if (linhaNorm !== p.linha_consolidada) {
                p.linha_consolidada = linhaNorm;
            }
        }
    }


    // ==========================================================
    // AUXILIARES INTERNOS
    // ==========================================================

    // Retorna o veículo mais frequente entre uma lista de paxIds
    static _veiculoMaisFrequente(session, paxEfetivosIds) {
        const freq = {};
        for (const paxId of paxEfetivosIds) {
            const pax = session.passageiros.find(p => p.id === paxId);
            if (!pax || !pax.veiculo) continue;
            freq[pax.veiculo] = (freq[pax.veiculo] || 0) + 1;
        }
        let melhor = "", melhorCount = 0;
        for (const [veiculo, count] of Object.entries(freq)) {
            if (count > melhorCount) { melhorCount = count; melhor = veiculo; }
        }
        return melhor;
    }

    // Retorna apenas viagens que recebem passageiros automaticamente (etapas A e B)
    _viagensConciliaveis(viagens = []) {
        const statusMap = Object.values(APP_CONFIG.engine.status);
        return viagens
            .filter(v => (statusMap.find(s => s.value === v.statusOriginal) || {}).concilia === true)
            .sort((a, b) => a.mInicio - b.mInicio);
    }

    // Atribui passageiro a viagem e registra metadados
    // paxEfetivos guarda apenas o ID — objeto completo vive em session.passageiros
    _atribuir(pax, viagem, metodo, delta = null) {
        pax.assigned          = true;
        pax.tripId            = viagem.id;
        pax.atribuicaoMetodo  = metodo;
        pax.deltaMinutos      = delta !== null ? Math.round(delta) : null;
        pax.linha_consolidada = viagem.linha_base;
        pax.sentido           = viagem.sentido || "UNICO";
        viagem.paxEfetivos.push(pax.id);
    }

    // Ajusta minutos do passageiro para comparação com viagem de pernoite.
    // Só para sessões antigas (sem tempoContinuo): na linha do tempo contínua
    // o horário do passageiro já está no lugar certo.
    _ajustarPernoite(pMin, viagem) {
        if (this._tempoContinuo) return pMin;
        if (viagem.pernoite && pMin < viagem.mInicio) return pMin + 1440;
        return pMin;
    }

    // Converte "HH:mm", "HH:mm:ss" ou "DD/MM/AAAA HH:mm:ss" em minutos do dia.
    // Retorna null quando não há horário.
    _toMin(str) {
        if (!str) return null;
        const match = String(str).match(/(\d{2}):(\d{2})/);
        if (!match) return null;
        return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    }

    // Minutos do horário do passageiro em relação à meia-noite do dia operacional.
    // Usa a data do próprio horário: dia seguinte → +1440. Sem data → minuto do dia.
    _minOperacional(str) {
        const min = this._toMin(str) ?? 0;
        const dia = Engine._diaIndex(str);
        if (dia === null || this._dia0 === null || this._dia0 === undefined) return min;
        return (dia - this._dia0) * 1440 + min;
    }

    // Índice do dia (dias desde 1970) a partir de "DD/MM/AAAA..." ou "AAAA-MM-DD..."
    static _diaIndex(str) {
        const s = String(str || "");
        let m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000;
        m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000;
        return null;
    }

    // ----------------------------------------------------------
    // Virada do dia no GPS
    // O GPS do dia D traz, com horário 00:xx–02:xx, tanto viagens que
    // ENCERRAM a noite de D quanto viagens que ABREM o dia D. É do fim
    // da noite a viagem que encadeia (pausa < gapJornadaMin) com a
    // última viagem da noite do mesmo carro; essas vão para 1440+.
    // Viagem sem veículo (ex: omissão) usa a tabela (empresa+linha+tabela).
    // A partir de horaCorte vale o horário do calendário.
    // ----------------------------------------------------------
    _ajustarMadrugadaGps(viagens) {
        const cfg      = APP_CONFIG.engine.virada;
        const corteMin = cfg.horaCorte * 60;
        const gap      = cfg.gapJornadaMin;

        const valido = (x) => !!x && x !== "-" && String(x).toLowerCase() !== "nan";
        const chaveTabela = (v) => valido(v.tabela) ? `${v.empresa}|${v.linha_base}|${v.tabela}` : null;

        const porVeiculo = {}, porTabela = {};
        for (const v of viagens) {
            if (valido(v.veiculo)) (porVeiculo[v.veiculo] = porVeiculo[v.veiculo] || []).push(v);
            const kt = chaveTabela(v);
            if (kt) (porTabela[kt] = porTabela[kt] || []).push(v);
        }

        // Encadeia as viagens da madrugada de um grupo a partir do fim da noite.
        // "proprias" diz quais viagens da madrugada este grupo pode mover.
        const encadear = (grupo, proprias) => {
            // Inclui viagens já movidas para 1440+ (passada por veículo)
            const dia = grupo.filter(v => v.mInicio >= corteMin);
            if (dia.length === 0) return;
            let fimNoite = Math.max(...dia.map(v => v.mFim));

            const madrugada = grupo
                .filter(v => v.mInicio < corteMin)
                .sort((a, b) => a.mInicio - b.mInicio);

            for (const v of madrugada) {
                if (v.mInicio + 1440 - fimNoite >= gap) break;
                if (proprias(v)) {
                    v.mInicio += 1440;
                    v.mFim    += 1440;
                    v.pernoite = false;
                    v.madrugadaSeguinte = true;
                }
                fimNoite = Math.max(fimNoite, v.mFim < 1440 ? v.mFim + 1440 : v.mFim);
            }
        };

        for (const grupo of Object.values(porVeiculo)) encadear(grupo, () => true);
        for (const grupo of Object.values(porTabela))  encadear(grupo, v => !valido(v.veiculo));
    }

    // Agrupa array de objetos por valor de uma chave
    _groupBy(array, key) {
        return array.reduce((acc, item) => {
            const k = item[key] || "";
            (acc[k] = acc[k] || []).push(item);
            return acc;
        }, {});
    }

    // Particiona array em [passa, nãoPassa] por predicado
    _partition(array, pred) {
        const a = [], b = [];
        for (const item of array) (pred(item) ? a : b).push(item);
        return [a, b];
    }


}
