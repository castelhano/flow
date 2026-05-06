// ============================================================
// main.js — Orquestração central
//
// Responsabilidade: conectar eventos da UI com as classes do core.
// Não contém lógica de negócio — apenas coordena chamadas.
//
// Fluxo principal:
//   1. Usuário carrega arquivo(s) CSV
//   2. Parser lê → DataNormalizer limpa → Engine processa → Session gerado
//   3. UIController renderiza o Session
//   4. Usuário interage (confirma sugestões, atribuição manual)
//   5. Engine.confirmarSugestoes / Engine.atribuirManualmente atualiza Session
//   6. UIController re-renderiza
// ============================================================


// ----------------------------------------------------------
// Estado global da aplicação
// session: objeto Session gerado pelo Engine (única fonte de verdade)
// rawGps / rawPax: linhas brutas dos CSVs (usados apenas para processar)
// ----------------------------------------------------------
const AppState = {
    rawGps:  null,
    rawPax:  null,
    session: null
};


// ----------------------------------------------------------
// Validação básica do CSV — lê a primeira linha de dados
// e verifica se os campos esperados estão nas colunas certas.
// Lança Error com mensagem amigável se inválido.
// ----------------------------------------------------------
function _validarCSV(rawData, tipo) {
    if (!rawData || rawData.length === 0) {
        throw new Error("Arquivo vazio ou sem registros de dados.");
    }

    const cfg   = tipo === "gps" ? APP_CONFIG.fontes.gps : APP_CONFIG.fontes.bilhetagem;
    const label = tipo === "gps" ? "GPS" : "bilhetagem";
    const row   = rawData[0];

    for (const [field, def] of Object.entries(cfg.colunas)) {
        if (typeof def !== "object" || !def.regex) continue;

        const idx = DataNormalizer._letraParaIndice(def.coluna);
        const val = String(row[idx] ?? "").trim();

        if (!def.regex.test(val)) {
            throw new Error(
                `Arquivo de ${label} inválido.\n` +
                `Campo "${field}" (coluna ${def.coluna}) — esperado: ${def.descricao}\n` +
                `Encontrado: "${val.substring(0, 60) || "(vazio)"}"`
            );
        }
    }

    // Detecta arquivo trocado: se o arquivo também passa o schema do OUTRO tipo,
    // o usuário provavelmente selecionou o arquivo errado.
    const outroTipo  = tipo === "gps" ? "bilhetagem" : "gps";
    const outroCfg   = outroTipo === "gps" ? APP_CONFIG.fontes.gps : APP_CONFIG.fontes.bilhetagem;
    const outroLabel = outroTipo === "gps" ? "GPS" : "bilhetagem";
    const passaOutro = Object.entries(outroCfg.colunas).every(([, def]) => {
        if (typeof def !== "object" || !def.regex) return true;
        const idx = DataNormalizer._letraParaIndice(def.coluna);
        const val = String(row[idx] ?? "").trim();
        return def.regex.test(val);
    });
    if (passaOutro) {
        throw new Error(
            `Arquivo de ${label} inválido: o arquivo selecionado parece ser o de ${outroLabel}.\n` +
            `Verifique se carregou o arquivo correto.`
        );
    }
}


// ----------------------------------------------------------
// Carregamento de arquivos
// Chamado pelo evento onchange dos inputs de arquivo
// ----------------------------------------------------------
async function handleFileSelect(tipo, file) {
    try {
        UIController.setStatusBadge("Lendo arquivo...", "muted");

        if (tipo === "gps") {
            const rawData = await Parser.readCSV(file);
            _validarCSV(rawData, "gps");
            AppState.rawGps = rawData;
        } else {
            const rawData = await Parser.readCSV(file);
            _validarCSV(rawData, "pax");
            AppState.rawPax = rawData;
        }

        // Atualiza badge e exibe botão de processar quando ambos estiverem prontos
        if (AppState.rawGps && AppState.rawPax) {
            UIController.setStatusBadge("Arquivos prontos!", "success");
            UIController.showElement("btn-processar");
        } else {
            UIController.setStatusBadge(
                `${tipo.toUpperCase()} carregado. Aguardando o outro arquivo...`,
                "muted"
            );
        }

        // Se apenas um arquivo foi carregado, exibe as funcionalidades disponíveis
        UIController.atualizarFuncionalidadesDisponiveis();

    } catch (err) {
        UIController.setStatusBadge("Erro ao ler arquivo.", "danger");
        alert(`Erro: ${err.message}`);
    }
}


// ----------------------------------------------------------
// Detecção de empresas presentes nos dados
// Chamado ao clicar em "Processar"
// ----------------------------------------------------------
function detectarEmpresas() {
    if (!AppState.rawGps) return;

    const normGps = new DataNormalizer(APP_CONFIG.fontes.gps);
    const normPax = new DataNormalizer(APP_CONFIG.fontes.bilhetagem);

    const empresasGps = [
        ...new Set(AppState.rawGps.map(r => normGps.normalize(r).empresa).filter(Boolean))
    ].sort();

    const empresasPax = AppState.rawPax
        ? [...new Set(AppState.rawPax.map(r => normPax.normalize(r).empresa).filter(Boolean))].sort()
        : [...empresasGps];

    UIController.showSeletorEmpresas({ empresasPax, empresasGps, onConciliar: executarProcessamento });
}


// ----------------------------------------------------------
// Execução do processamento principal (primeiro carregamento)
// empresasPax   — passageiros a incluir (painel 1)
// empresasConciliacao — empresas a conciliar agora (painel 2)
// ----------------------------------------------------------
function executarProcessamento({ empresasPax, empresasConciliacao }) {
    UIController.showLoader("Processando...");

    // setTimeout garante que o loader renderiza antes do processamento bloquear a thread
    setTimeout(() => {
        try {
            const normGps = new DataNormalizer(APP_CONFIG.fontes.gps);
            const normPax = new DataNormalizer(APP_CONFIG.fontes.bilhetagem);

            // GPS: filtrado pelas empresas do corte (painel 1).
            // Fallback: se a normalização GPS não mapeou a empresa (nome diferente entre arquivos),
            // tenta o mapeamento da bilhetagem — cobre empresas com mesmo nome nos dois arquivos.
            const paxEmpNorm    = APP_CONFIG.fontes.bilhetagem.normalizacao.empresa || {};
            const empresasPaxSet = new Set(empresasPax);

            const gpsLimpo = AppState.rawGps
                .map(r => {
                    const n = normGps.normalize(r);
                    if (!empresasPaxSet.has(n.empresa) && paxEmpNorm[n.empresa]) {
                        n.empresa = paxEmpNorm[n.empresa];
                    }
                    return n;
                })
                .filter(r => empresasPaxSet.has(r.empresa));

            // Pax: apenas empresas do corte (painel 1)
            const paxLimpo = AppState.rawPax
                ? AppState.rawPax
                    .map(r => normPax.normalize(r))
                    .filter(r => empresasPaxSet.has(r.empresa))
                : [];

            const engine     = new Engine(gpsLimpo, paxLimpo);
            AppState.session = engine.process(empresasConciliacao);

            const empresasNoSession = [...new Set(AppState.session.viagens.map(v => v.empresa).filter(Boolean))].sort();
            UIController.showSeletorConciliacao(empresasNoSession, conciliarSobreSession);

            UIController.updateDashboard(AppState.session);
            UIController.hideLoader();

        } catch (err) {
            UIController.hideLoader();
            alert(`Erro no processamento: ${err.message}`);
            console.error(err);
        }
    }, 80);
}


// ----------------------------------------------------------
// Exibe seletor de conciliação após importar trabalho salvo
// ----------------------------------------------------------
function iniciarSeletorConciliacaoPostImport(session) {
    const empresas = [...new Set(session.viagens.map(v => v.empresa).filter(Boolean))].sort();
    UIController.showSeletorConciliacao(empresas, conciliarSobreSession);
}


// ----------------------------------------------------------
// Conciliação incremental sobre session já existente
// Preserva tudo já conciliado — processa só os pax não-atribuídos
// das empresas selecionadas
// ----------------------------------------------------------
function conciliarSobreSession(empresasConciliacao) {
    UIController.showLoader("Conciliando...");
    setTimeout(() => {
        try {
            AppState.session = Engine.conciliarIncremental(AppState.session, empresasConciliacao);
            UIController.updateDashboard(AppState.session);
            UIController.setStatusBadge("Conciliação atualizada", "success");
        } catch (err) {
            alert(`Erro na conciliação: ${err.message}`);
            console.error(err);
        }
        UIController.hideLoader();
    }, 80);
}


// ----------------------------------------------------------
// Confirmação de sugestões da etapa C
// Chamado pelo botão "Atribuir selecionados" na seção de sugestões
// ----------------------------------------------------------
function confirmarSugestoesSelecionadas() {
    const selecionados = Array.from(
        document.querySelectorAll(".sugestao-checkbox:checked")
    ).map(cb => cb.value);

    if (selecionados.length === 0) return alert("Nenhuma sugestão selecionada.");

    AppState.session = Engine.confirmarSugestoes(AppState.session, selecionados);
    UIController.updateDashboard(AppState.session);
}


// ----------------------------------------------------------
// Atribuição manual (tabela de exceções → viagem destino)
// Chamado pelo botão "Atribuir" no rodapé da tabela
// ----------------------------------------------------------
function atribuirManualmente() {
    const tripId   = document.getElementById("select-target-trip").value;
    const marcados = Array.from(
        document.querySelectorAll(".pax-checkbox:checked")
    ).map(cb => cb.value);

    if (!tripId || marcados.length === 0) {
        return alert("Selecione a viagem de destino e ao menos um passageiro.");
    }

    AppState.session = Engine.atribuirManualmente(AppState.session, marcados, tripId);
    UIController.updateDashboard(AppState.session);
    document.getElementById("omissao-alert").style.display = "none";
}


// ----------------------------------------------------------
// Inicialização
// ----------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();

    UIController.initFiltros();
    UIController.initSelectAll();

    // Botões principais
    document.getElementById("btn-processar")
        .addEventListener("click", detectarEmpresas);
    document.getElementById("btn-atribuir")
        .addEventListener("click", atribuirManualmente);
    document.getElementById("btn-confirmar-sugestoes")
        .addEventListener("click", confirmarSugestoesSelecionadas);

    // Filtros da tabela de sugestões
    document.getElementById("sug-filter-btn")
        .addEventListener("click", () => UIController.aplicarFiltrosSugestoes());
    document.getElementById("sug-clear-btn")
        .addEventListener("click", () => UIController.limparFiltrosSugestoes());

    // Filtros da tabela de exceções
    document.getElementById("filter_btn")
        .addEventListener("click", () => UIController.aplicarFiltros());
    document.getElementById("clear_btn")
        .addEventListener("click", () => UIController.limparFiltros());

    document.getElementById("btn-csv-sugestoes")
        .addEventListener("click", () => UIController.exportCSVSugestoes());
    document.getElementById("btn-csv-excecoes")
        .addEventListener("click", () => UIController.exportCSVExcecoes());

    // Busca de viagens no seletor manual
    document.getElementById("btn-buscar-viagens")
        .addEventListener("click", () => UIController.atualizarSeletorViagens());
});
