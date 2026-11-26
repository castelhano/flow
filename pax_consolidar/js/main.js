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
// paxFiles: referências aos CSVs de bilhetagem (não ocupam memória). Só são
//   lidos no "Processar", já recortados no dia do GPS (PaxCorte). Podem ser
//   vários períodos: o vizinho completa a virada do dia.
// paxDia / paxCorte: dia do recorte em rawPax e resumo do recorte
// ----------------------------------------------------------
const AppState = {
    rawGps:   null,
    rawPax:   null,
    paxFiles: [],
    paxDia:   null,
    paxCorte: null,
    session:  null,
    // Fonte do GPS: "sonda" (CSV, linhas cruas) ou "cittati" (BI, linhas já
    // normalizadas pelo Cittati.js). cittatiMeta: data e atualização do BI.
    gpsFonte:    null,
    cittatiMeta: null,
    // Flags de leitura em andamento — evita liberar "Processar"
    // enquanto um arquivo grande (ex: bilhetagem) ainda está sendo parseado.
    loading: { gps: false, pax: false }
};


// ----------------------------------------------------------
// Linha de GPS normalizada, qualquer que seja a fonte.
// Cittati já chega normalizada (Cittati.paraGps); Sonda passa pelo
// DataNormalizer com o layout de colunas do settings.
// ----------------------------------------------------------
let _normalizadorSonda = null;
function _normGps(row) {
    if (AppState.gpsFonte === "cittati") return row;
    _normalizadorSonda = _normalizadorSonda || new DataNormalizer(APP_CONFIG.fontes.gps);
    return _normalizadorSonda.normalize(row);
}


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
    console.log(`[DEBUG _validarCSV] ${label} passou na validação. passaOutro (${outroLabel}):`, passaOutro);
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
    AppState.loading[tipo === "gps" ? "gps" : "pax"] = true;
    UIController.atualizarFuncionalidadesDisponiveis();

    try {
        UIController.setStatusBadge("Lendo arquivo...", "muted");

        if (tipo === "gps" && /\.json$/i.test(file.name)) {
            // JSON salvo do serviço Cittati (mesmo formato de /viagens)
            const resposta = JSON.parse(await file.text());
            _usarGpsCittati(resposta, file.name);
        } else if (tipo === "gps") {
            const rawData = await Parser.readCSV(file);
            _validarCSV(rawData, "gps");
            AppState.rawGps      = rawData;
            AppState.gpsFonte    = "sonda";
            AppState.cittatiMeta = null;
            UIController.marcarGpsCarregado("gps", file.name);
        } else {
            // Bilhetagem pode ter vários arquivos e centenas de MB: aqui só valida
            // o layout. A leitura (recortada no dia do GPS) acontece no Processar.
            // Cada seleção soma à lista (mesmo arquivo não entra duas vezes).
            const novos = Array.isArray(file) ? file : [file];
            for (const f of novos) {
                try { await PaxCorte.validar(f); }
                catch (e) { throw new Error(`${f.name}: ${e.message}`); }
            }
            const chave = f => `${f.name}|${f.size}|${f.lastModified}`;
            const atuais = new Set(AppState.paxFiles.map(chave));
            AppState.paxFiles = [...AppState.paxFiles, ...novos.filter(f => !atuais.has(chave(f)))];
            AppState.rawPax   = null;
            AppState.paxDia   = null;
            AppState.paxCorte = null;
        }

        if (tipo === "gps") _avisarGpsSemRealizadas();

        // Atualiza badge e exibe botão de processar quando ambos estiverem prontos
        if (AppState.rawGps && AppState.paxFiles.length) {
            UIController.setStatusBadge("Arquivos prontos!", "success");
        } else {
            UIController.setStatusBadge(
                `${tipo.toUpperCase()} carregado. Aguardando o outro arquivo...`,
                "muted"
            );
        }

    } catch (err) {
        UIController.setStatusBadge("Erro ao ler arquivo.", "danger");
        alert(`Erro: ${err.message}`);
    } finally {
        AppState.loading[tipo === "gps" ? "gps" : "pax"] = false;
        // Se apenas um arquivo foi carregado, exibe as funcionalidades disponíveis
        UIController.atualizarFuncionalidadesDisponiveis();
    }
}


// ----------------------------------------------------------
// GPS Cittati
// _usarGpsCittati: recebe a resposta do serviço (ou o mesmo JSON salvo
//   em arquivo) e passa a usá-la como GPS. Lança Error se inválida.
// buscarGpsCittati: consulta o serviço para o dia escolhido na tela.
// listarDiasCittati: preenche a lista de dias disponíveis no BI.
// ----------------------------------------------------------
function _usarGpsCittati(resposta, origem) {
    const linhas = Cittati.paraGps(resposta);   // valida e converte
    AppState.rawGps      = linhas;
    AppState.gpsFonte    = "cittati";
    AppState.cittatiMeta = {
        data:           resposta.data,
        biAtualizadoEm: resposta.biAtualizadoEm || null,
        geradoEm:       resposta.geradoEm || null,
        origem
    };
    const resumo = `${Cittati.isoParaBR(resposta.data)} — ${linhas.length.toLocaleString("pt-BR")} viagens`;
    // Do serviço: marca o card Cittati. De arquivo: o card de GPS já mostra o nome.
    UIController.marcarGpsCarregado(origem === "serviço" ? "cittati" : "gps",
        origem === "serviço" ? resumo : `${origem} (${resumo})`);
}

async function buscarGpsCittati() {
    const data = document.getElementById("cittati-dia")?.value;
    if (!data) return alert("Escolha o dia.");

    AppState.loading.gps = true;
    UIController.atualizarFuncionalidadesDisponiveis();
    UIController.showLoader(`Buscando viagens da Cittati de ${Cittati.isoParaBR(data)}...`);
    try {
        const resposta = await Cittati.viagensDoDia(data);
        _usarGpsCittati(resposta, "serviço");
        _avisarGpsSemRealizadas();
        UIController.setStatusBadge(
            AppState.paxFiles.length ? "Arquivos prontos!" : "GPS Cittati carregado. Bilhetagem é opcional.",
            "success"
        );
    } catch (err) {
        UIController.setStatusBadge("Erro ao buscar a Cittati.", "danger");
        alert(`Erro: ${err.message}`);
    } finally {
        UIController.hideLoader();
        AppState.loading.gps = false;
        UIController.atualizarFuncionalidadesDisponiveis();
    }
}

async function listarDiasCittati() {
    const select = document.getElementById("cittati-dia");
    const info   = document.getElementById("cittati-info");
    const botao  = document.getElementById("btn-cittati-buscar");
    if (!select) return;
    try {
        const dias = await Cittati.dias();
        select.innerHTML = dias.slice().reverse()
            .map(d => `<option value="${d}">${Cittati.isoParaBR(d)}</option>`).join("");
        select.disabled = botao.disabled = dias.length === 0;
        if (info) info.innerText = dias.length ? "dias disponíveis no BI" : "BI sem dias disponíveis";
    } catch (err) {
        select.innerHTML = "<option value=''>serviço indisponível</option>";
        select.disabled = botao.disabled = true;
        if (info) {
            info.innerText = "serviço indisponível — dá para carregar o .json no card de GPS";
            info.title = err.message;
        }
    }
}


// ----------------------------------------------------------
// Remove os arquivos de bilhetagem carregados
// ----------------------------------------------------------
function limparBilhetagem() {
    AppState.paxFiles = [];
    AppState.rawPax   = null;
    AppState.paxDia   = null;
    AppState.paxCorte = null;
    UIController.setStatusBadge("Bilhetagem removida.", "muted");
}


// ----------------------------------------------------------
// Avisa quando o GPS não tem nenhuma viagem que concilia
// (ex: export de data futura — tudo "Não iniciado")
// ----------------------------------------------------------
function _avisarGpsSemRealizadas() {
    const status = Object.values(APP_CONFIG.engine.status).filter(s => s.concilia).map(s => s.value);
    const linhas = AppState.rawGps || [];
    const realizadas = linhas.filter(r => status.includes(String(_normGps(r).statusViagem))).length;
    if (linhas.length > 0 && realizadas === 0) {
        const data = _normGps(linhas[0]).data;
        alert(
            `GPS sem viagens realizadas.\n\n` +
            `Nenhuma das ${linhas.length} viagens de ${data} tem status ${status.join(" ou ")}. ` +
            `Verifique se o export do GPS é da data certa (data futura vem toda como "Não iniciado").`
        );
    }
}


// ----------------------------------------------------------
// Lê a bilhetagem recortada no dia operacional do GPS.
// Reaproveita o recorte se o dia não mudou.
// ----------------------------------------------------------
async function _carregarPaxDoDia() {
    if (!AppState.paxFiles.length || !AppState.rawGps?.length) return;

    const dia     = _normGps(AppState.rawGps[0]).data;
    if (AppState.rawPax && AppState.paxDia === dia) return;

    AppState.rawPax = null;
    UIController.showLoader(`Lendo bilhetagem do dia ${dia}...`);
    try {
        const { linhas, resumo } = await PaxCorte.carregar(AppState.paxFiles, dia, (f) => {
            UIController.showLoader(`Lendo bilhetagem do dia ${dia}... ${Math.round(f * 100)}%`);
        });
        if (linhas.length === 0) throw new Error(resumo.alertas[0]);
        AppState.rawPax   = linhas;
        AppState.paxDia   = dia;
        AppState.paxCorte = resumo;
        console.log("[PaxCorte]", dia, resumo);
    } finally {
        UIController.hideLoader();
    }

    const r = AppState.paxCorte;
    UIController.setStatusBadge(
        `Bilhetagem ${dia}: ${r.noDia.toLocaleString("pt-BR")} registros ` +
        `(+${r.doDiaSeguinte} da madrugada seguinte, ` +
        `-${r.daNoiteAnterior} da noite anterior` +
        (r.duplicados ? `, ${r.duplicados.toLocaleString("pt-BR")} repetidos entre arquivos` : "") + `)`,
        r.alertas.length ? "danger" : r.avisos.length ? "warning" : "success"
    );

    // Alertas: faltam dados do próprio dia. Avisos: virada do dia (opcional).
    const blocos = [];
    if (r.alertas.length) {
        blocos.push(`ATENÇÃO — dados do dia\n\n• ${r.alertas.join("\n\n• ")}`);
    }
    if (r.avisos.length) {
        blocos.push(
            `Virada do dia — arquivo adicional OPCIONAL\n` +
            `(não é obrigatório: o processamento segue normalmente)\n\n` +
            `• ${r.avisos.join("\n\n• ")}`
        );
    }
    if (blocos.length) alert(`Bilhetagem\n\n${blocos.join("\n\n────────────\n\n")}`);
}


// ----------------------------------------------------------
// Detecção de empresas presentes nos dados
// Chamado ao clicar em "Processar"
// ----------------------------------------------------------
async function detectarEmpresas() {
    if (!AppState.rawGps) return;

    try {
        await _carregarPaxDoDia();
    } catch (err) {
        UIController.setStatusBadge("Erro ao ler bilhetagem.", "danger");
        alert(`Erro: ${err.message}`);
        return;
    }

    const normPax = new DataNormalizer(APP_CONFIG.fontes.bilhetagem);

    const empresasGps = [
        ...new Set(AppState.rawGps.map(r => _normGps(r).empresa).filter(Boolean))
    ].sort();

    const empresasPax = AppState.rawPax
        ? [...new Set(AppState.rawPax.map(r => normPax.normalize(r).empresa).filter(Boolean))].sort()
        : [...empresasGps];

    console.log("[DEBUG detectarEmpresas] rawGps.length:", AppState.rawGps.length,
        "| rawPax.length:", AppState.rawPax ? AppState.rawPax.length : null);
    console.log("[DEBUG detectarEmpresas] amostra normalizada GPS[0]:", _normGps(AppState.rawGps[0]));
    if (AppState.rawPax) console.log("[DEBUG detectarEmpresas] amostra normalizada PAX[0]:", normPax.normalize(AppState.rawPax[0]));
    console.log("[DEBUG detectarEmpresas] empresasGps:", empresasGps);
    console.log("[DEBUG detectarEmpresas] empresasPax:", empresasPax);

    UIController.showSeletorEmpresas({ empresasPax, empresasGps, onConciliar: executarProcessamento });
}


// ----------------------------------------------------------
// Execução do processamento principal (primeiro carregamento)
// empresasPax   — passageiros a incluir (painel 1)
// empresasConciliacao — empresas a conciliar agora (painel 2)
// ----------------------------------------------------------
function executarProcessamento({ empresasPax, empresasConciliacao }) {
    UIController.showLoader("Processando...");

    console.log("[DEBUG executarProcessamento] empresasPax (painel 1, selecionadas):", empresasPax);
    console.log("[DEBUG executarProcessamento] empresasConciliacao (painel 2, selecionadas):", empresasConciliacao);

    // setTimeout garante que o loader renderiza antes do processamento bloquear a thread
    setTimeout(() => {
        try {
            const normPax = new DataNormalizer(APP_CONFIG.fontes.bilhetagem);

            // GPS: filtrado pelas empresas do corte (painel 1).
            // Fallback: se a normalização GPS não mapeou a empresa (nome diferente entre arquivos),
            // tenta o mapeamento da bilhetagem — cobre empresas com mesmo nome nos dois arquivos.
            const paxEmpNorm    = APP_CONFIG.fontes.bilhetagem.normalizacao.empresa || {};
            const empresasPaxSet = new Set(empresasPax);

            const gpsLimpo = AppState.rawGps
                .map(r => {
                    const n = { ..._normGps(r) };
                    if (!empresasPaxSet.has(n.empresa) && paxEmpNorm[n.empresa]) {
                        n.empresa = paxEmpNorm[n.empresa];
                    }
                    return n;
                })
                .filter(r => empresasPaxSet.has(r.empresa));

            // Pax: apenas empresas do corte (painel 1)
            const paxNormalizado = AppState.rawPax ? AppState.rawPax.map(r => normPax.normalize(r)) : [];
            const paxLimpo = paxNormalizado.filter(r => empresasPaxSet.has(r.empresa));

            console.log("[DEBUG executarProcessamento] gpsLimpo.length:", gpsLimpo.length,
                "de", AppState.rawGps.length);
            console.log("[DEBUG executarProcessamento] paxNormalizado.length:", paxNormalizado.length,
                "| paxLimpo.length (pós filtro empresasPaxSet):", paxLimpo.length);
            console.log("[DEBUG executarProcessamento] empresas distintas em paxNormalizado:",
                [...new Set(paxNormalizado.map(p => p.empresa))]);
            console.log("[DEBUG executarProcessamento] amostra paxNormalizado[0..2]:", paxNormalizado.slice(0, 3));

            const engine     = new Engine(gpsLimpo, paxLimpo);
            AppState.session = engine.process(empresasConciliacao);
            AppState.session.fonteGps    = AppState.gpsFonte;
            AppState.session.cittatiMeta = AppState.cittatiMeta;

            console.log("[DEBUG executarProcessamento] session.resumo:", AppState.session.resumo);
            console.log("[DEBUG executarProcessamento] session.empresasConciliadas:", AppState.session.empresasConciliadas);

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

    // GPS Cittati: lista de dias do serviço
    document.getElementById("btn-cittati-buscar")
        ?.addEventListener("click", buscarGpsCittati);
    listarDiasCittati();

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
