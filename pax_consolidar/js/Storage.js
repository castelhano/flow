// ============================================================
// Storage.js — Persistência do Session
//
// Responsabilidade: exportar e importar o Session como JSON.
// O arquivo gerado é o "trabalho salvo" — carregá-lo restaura
// o estado completo sem necessidade de reimportar os CSVs.
//
// Não conhece o Engine, não conhece a UI diretamente.
// Chama UIController apenas para atualizar a interface após importação.
// ============================================================

const Storage = {

    // ----------------------------------------------------------
    // Exporta o Session atual para um arquivo JSON
    // Nome: PREFIX_AAAA_MM_DD_ABBR1_ABBR2.json
    // Campos removidos do export (reconstruídos no import):
    //   _idx        — índices internos do Engine, não necessários
    //   paxIgnorados — subconjunto de passageiros, filtrado no import
    //   sugestoes.pax / sugestoes.viagem — refs inline, rebuilt no import
    // ----------------------------------------------------------
    exportJSON(prefix = "FULL") {
        if (!AppState.session) {
            return alert("Não há dados processados para exportar.");
        }

        const session = AppState.session;

        // --- Data de operação (DD/MM/AAAA ou DD/MM/AAAA HH:mm:ss) ---
        let dataFormatada = new Date().toISOString().split("T")[0].replace(/-/g, "_");
        const matchData = (session.dataOperacao || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (matchData) {
            dataFormatada = `${matchData[3]}_${matchData[2]}_${matchData[1]}`;
        }

        // --- Abreviações das empresas presentes nas viagens ---
        const empresasCfg    = APP_CONFIG.empresas || {};
        const nomesPresentes = [...new Set(session.viagens.map(v => v.empresa).filter(Boolean))].sort();
        const abbrs          = nomesPresentes
            .map(nome => Object.values(empresasCfg).find(e => e.nome === nome)?.abbr || nome)
            .join("_");

        // --- Session limpo para serialização ---
        // eslint-disable-next-line no-unused-vars
        const { _idx, paxIgnorados, ...sessionExport } = session;
        sessionExport.sugestoes = session.sugestoes.map(({ pax, viagem, ...s }) => s);

        const payload = {
            versao:      "2.0",
            dataGeracao: new Date().toLocaleString("pt-BR"),
            config:      APP_CONFIG.engine,
            session:     sessionExport
        };

        const blob = new Blob(
            [JSON.stringify(payload)],
            { type: "application/json" }
        );

        const nomeArquivo = abbrs
            ? `${prefix}_${dataFormatada}_${abbrs}.json`
            : `${prefix}_${dataFormatada}.json`;

        const url = URL.createObjectURL(blob);
        const a   = document.createElement("a");
        a.href     = url;
        a.download = nomeArquivo;
        a.click();
        URL.revokeObjectURL(url);
    },


    // ----------------------------------------------------------
    // Importa um JSON gerado anteriormente e restaura o AppState
    // ----------------------------------------------------------
    importJSON(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);

                // Validação mínima de estrutura
                if (!imported.session || !imported.versao) {
                    return alert("Arquivo inválido: não é um trabalho TransSync.");
                }

                const session = imported.session;

                // Reconstrói paxIgnorados (removido do export para evitar duplicação)
                const linhasIgn = new Set((APP_CONFIG.fontes.bilhetagem.linhasIgnoradas || []).map(l => String(l).trim()));
                session.paxIgnorados = session.passageiros.filter(p => linhasIgn.has(p.linha_consolidada));

                // Reconstrói refs pax/viagem nas sugestões (removidas do export)
                if (session.sugestoes?.length > 0) {
                    const paxMap  = Object.fromEntries(session.passageiros.map(p => [p.id, p]));
                    const tripMap = Object.fromEntries(session.viagens.map(v => [v.id, v]));
                    for (const s of session.sugestoes) {
                        s.pax    = paxMap[s.paxId];
                        s.viagem = tripMap[s.tripId];
                    }
                }

                AppState.session = session;

                UIController.updateDashboard(AppState.session);
                UIController.setStatusBadge("Trabalho restaurado — selecione empresas para conciliar", "primary");

                // Exibe seletor de conciliação incremental (painel 2 apenas)
                if (typeof iniciarSeletorConciliacaoPostImport === "function") {
                    iniciarSeletorConciliacaoPostImport(session);
                }

            } catch {
                alert("Erro ao ler o arquivo. Verifique se o JSON não está corrompido.");
            }
        };
        reader.readAsText(file);
    }
};
