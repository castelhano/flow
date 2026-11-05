// ============================================================
// Estado
// ============================================================
const state = {
    nomeArquivo: "",
    analise: null,
    decisoes: {},    // { chave da tabela: "manter" | "corrigir" }
    programacoes: {}, // { "data|linha": { codigo, confirmado } }
    resultado: null,
};

const REMOCAO = "Evento removido";
const DIA = "Dia corrigido";
const PROGRAMACAO = "Programação preenchida";

// ============================================================
// DOM refs
// ============================================================
const $ = id => document.getElementById(id);

const el = {
    dropZone: $("drop-txt"),
    fileInput: $("input-txt"),
    dropInfo: $("drop-txt-info"),
    statusBadge: $("status-badge"),

    sectionAnalise: $("section-analise"),
    statLidas: $("stat-lidas"),
    statTabelas: $("stat-tabelas"),
    statRemovidos: $("stat-removidos"),
    statDias: $("stat-dias"),
    statCriticas: $("stat-criticas"),
    criticasBody: $("criticas-body"),
    criticasWrap: $("criticas-wrap"),
    criticasVazio: $("criticas-vazio"),
    remocoesResumo: $("remocoes-resumo"),
    alteracoesBody: $("alteracoes-body"),
    alteracoesWrap: $("alteracoes-wrap"),
    alteracoesVazio: $("alteracoes-vazio"),

    sectionProgramacao: $("section-programacao"),
    programacaoNum: $("programacao-num"),
    programacaoBody: $("programacao-body"),

    sectionDuvidas: $("section-duvidas"),
    duvidasNum: $("duvidas-num"),
    duvidasBody: $("duvidas-body"),

    sectionExportar: $("section-exportar"),
    exportarNum: $("exportar-num"),
    exportarResumo: $("exportar-resumo"),
    btnProg: $("btn-prog"),
    btnEscala: $("btn-escala"),
    btnLog: $("btn-log"),
};

// ============================================================
// Latin-1 byte a byte: o arquivo sai idêntico ao que entrou
// em tudo que a rotina não altera, inclusive acentos.
// ============================================================
function decodificar(buffer) {
    const bytes = new Uint8Array(buffer);
    let texto = "";
    for (let i = 0; i < bytes.length; i += 8192) {
        texto += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return texto;
}

function codificar(texto) {
    return Uint8Array.from(texto, c => c.charCodeAt(0));
}

function baixar(conteudo, nome, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const link = document.createElement("a");
    link.href = url;
    link.download = nome;
    link.click();
    URL.revokeObjectURL(url);
}

function nomeBase() {
    return state.nomeArquivo.replace(/\.[^.]+$/, "");
}

// ============================================================
// Carga do arquivo
// ============================================================
async function carregarArquivo(arquivo) {
    if (!arquivo) return;

    try {
        const texto = decodificar(await arquivo.arrayBuffer());
        state.analise = GlobusEngine.analisar(texto);
        state.nomeArquivo = arquivo.name;
        state.decisoes = {};
        state.programacoes = Object.fromEntries(state.analise.semProgramacao.map(
            item => [item.chave, { codigo: item.sugestao, confirmado: false }]
        ));
    } catch (err) {
        state.analise = null;
        el.dropZone.classList.remove("loaded");
        el.dropInfo.textContent = ".txt — clique ou arraste o arquivo";
        el.sectionAnalise.classList.add("hidden");
        el.sectionProgramacao.classList.add("hidden");
        el.sectionDuvidas.classList.add("hidden");
        el.sectionExportar.classList.add("hidden");
        el.statusBadge.textContent = "Erro ao ler arquivo";
        alert(err.message);
        return;
    }

    el.dropZone.classList.add("loaded");
    el.dropInfo.textContent = arquivo.name;
    el.sectionAnalise.classList.remove("hidden");
    renderEtapas();
    renderProgramacao();
    renderDuvidas();
    atualizarResultado();
}

// ============================================================
// Renderização
// ============================================================
function preencherTabela(tbody, linhas) {
    tbody.replaceChildren(...linhas.map(valores => {
        const tr = document.createElement("tr");
        for (const valor of valores) {
            const td = document.createElement("td");
            td.textContent = valor;
            tr.appendChild(td);
        }
        return tr;
    }));
}

function mostrarLista(wrap, vazio, temItens) {
    wrap.classList.toggle("hidden", !temItens);
    vazio.classList.toggle("hidden", temItens);
}

function resumirRemocoes() {
    const porMotivo = new Map();
    for (const { motivoRemocao } of state.analise.removidos) {
        porMotivo.set(motivoRemocao, (porMotivo.get(motivoRemocao) || 0) + 1);
    }
    return [...porMotivo].map(([motivo, total]) => `${total} (${motivo})`).join(", ");
}

function listarAlteracoes() {
    const remocoes = state.analise.removidos.map(({ campos, motivoRemocao }) => {
        const e = GlobusEngine.dadosEvento(campos);
        return [`${REMOCAO} (${motivoRemocao})`, e.data, e.linha, e.tabela, e.seq, `${e.inicio}–${e.fim}`, "—", "—"];
    });
    const programacoes = state.resultado.programacoesPreenchidas.map(p => (
        [`${PROGRAMACAO} (${p.total} eventos)`, p.data, p.linha, "—", "—", "—", "—", p.codigo]
    ));
    const dias = state.resultado.alteracoesDia.map(a => (
        [DIA, a.data, a.linha, a.tabela, a.seq, `${a.inicio}–${a.fim}`, a.de, a.para]
    ));
    return [...remocoes, ...programacoes, ...dias];
}

// As etapas de confirmação só aparecem quando há o que confirmar
function renderEtapas() {
    const { semProgramacao, duvidas } = state.analise;
    let etapa = 2;
    const proxima = () => `ETAPA ${String(++etapa).padStart(2, "0")}`;

    el.sectionProgramacao.classList.toggle("hidden", !semProgramacao.length);
    if (semProgramacao.length) el.programacaoNum.textContent = proxima();

    el.sectionDuvidas.classList.toggle("hidden", !duvidas.length);
    if (duvidas.length) el.duvidasNum.textContent = proxima();

    el.exportarNum.textContent = proxima();
}

function renderProgramacao() {
    el.programacaoBody.replaceChildren(...state.analise.semProgramacao.map(item => {
        const programacao = state.programacoes[item.chave];
        const tr = document.createElement("tr");

        [item.data, item.linha, item.totalEventos, item.sugestao || "Sem sugestão"].forEach(valor => {
            const td = document.createElement("td");
            td.textContent = valor;
            tr.appendChild(td);
        });

        const input = document.createElement("input");
        input.className = "prog-input";
        input.value = programacao.codigo;

        const confirmar = document.createElement("input");
        confirmar.type = "checkbox";
        confirmar.disabled = !programacao.codigo;

        // O ";" quebraria o layout e fora do Latin-1 o caractere não sobrevive à gravação
        input.addEventListener("input", () => {
            input.value = input.value.replace(/[;\u0100-\uffff]/g, "");
            programacao.codigo = input.value.trim();
            programacao.confirmado = false;
            confirmar.checked = false;
            confirmar.disabled = !programacao.codigo;
            atualizarResultado();
        });
        confirmar.addEventListener("change", () => {
            programacao.confirmado = confirmar.checked;
            atualizarResultado();
        });

        const tdInput = document.createElement("td");
        tdInput.appendChild(input);
        const tdConfirmar = document.createElement("td");
        tdConfirmar.appendChild(confirmar);
        tr.append(tdInput, tdConfirmar);
        return tr;
    }));
}

function programacoesConfirmadas() {
    return Object.fromEntries(
        Object.entries(state.programacoes)
            .filter(([, p]) => p.confirmado)
            .map(([chave, p]) => [chave, p.codigo])
    );
}

function renderDuvidas() {
    el.duvidasBody.replaceChildren(...state.analise.duvidas.map(grupo => {
        const tr = document.createElement("tr");
        const eventos = grupo.divergencias.map(({ evento, atual, esperado }) => {
            const e = GlobusEngine.dadosEvento(evento.campos);
            return `Seq ${e.seq}, ${e.inicio}–${e.fim}: dia ${atual.inicio} → dia ${esperado.inicio}`;
        });

        [grupo.data, grupo.linha, grupo.tabela, grupo.motivoDuvida, eventos.join("\n")].forEach(valor => {
            const td = document.createElement("td");
            td.textContent = valor;
            tr.appendChild(td);
        });
        tr.lastChild.className = "duvida-eventos";

        const select = document.createElement("select");
        select.className = "duvida-select";
        [["", "Selecione..."], ["manter", "Manter dias do arquivo"], ["corrigir", "Aplicar dias da regra"]]
            .forEach(([valor, rotulo]) => select.add(new Option(rotulo, valor)));
        select.addEventListener("change", () => {
            if (select.value) state.decisoes[grupo.chave] = select.value;
            else delete state.decisoes[grupo.chave];
            atualizarResultado();
        });

        const td = document.createElement("td");
        td.appendChild(select);
        tr.appendChild(td);
        return tr;
    }));
}

function atualizarResultado() {
    const { analise } = state;
    state.resultado = GlobusEngine.resolver(analise, state.decisoes, programacoesConfirmadas());
    const { alteracoesDia, criticas, totalLinhas, sequenciasAlteradas } = state.resultado;

    el.statLidas.textContent = analise.totalLinhas;
    el.statTabelas.textContent = analise.grupos.length;
    el.statRemovidos.textContent = analise.removidos.length;
    el.statDias.textContent = alteracoesDia.length;
    el.statCriticas.textContent = criticas.length;

    const criticasTela = GlobusEngine.resumirCriticas(criticas);
    preencherTabela(el.criticasBody, criticasTela.map(c => [c.tipo, c.data, c.linha, c.tabela, c.detalhe]));
    mostrarLista(el.criticasWrap, el.criticasVazio, criticas.length > 0);

    const remocoes = resumirRemocoes();
    el.remocoesResumo.textContent = `Eventos removidos: ${remocoes}.`;
    el.remocoesResumo.classList.toggle("hidden", !remocoes);

    const alteracoes = listarAlteracoes();
    preencherTabela(el.alteracoesBody, alteracoes);
    mostrarLista(el.alteracoesWrap, el.alteracoesVazio, alteracoes.length > 0);

    const pendentes = analise.duvidas.filter(g => !state.decisoes[g.chave]).length
        + Object.values(state.programacoes).filter(p => !p.confirmado).length;
    el.btnProg.disabled = pendentes > 0;
    el.btnEscala.disabled = pendentes > 0;
    el.sectionExportar.classList.remove("hidden");
    el.exportarResumo.textContent = pendentes
        ? `Faltam ${pendentes} confirmação(ões) nas etapas anteriores.`
        : `${totalLinhas} linhas no arquivo final, ${sequenciasAlteradas} sequência(s) renumerada(s). As críticas não bloqueiam a exportação.`;
    el.statusBadge.textContent = pendentes ? "Aguardando confirmação" : "Pronto para exportar";
}

// ============================================================
// Exportação
// ============================================================
function exportarArquivo(tipo) {
    baixar(codificar(state.resultado[tipo]), `${nomeBase()}_${tipo}.txt`, "text/plain");
}

function exportarLog() {
    const csv = valor => `"${String(valor).replace(/"/g, '""')}"`;
    const cabecalho = ["Alteração", "Data", "Linha", "Tabela", "Seq", "Horário", "Dia antes", "Dia depois"];
    const alteracoes = [cabecalho, ...listarAlteracoes()];
    const criticas = [
        ["Crítica", "Data", "Linha", "Tabela", "Detalhe"],
        ...state.resultado.criticas.map(c => [c.tipo, c.data, c.linha, c.tabela, c.detalhe]),
    ];
    const linhas = [...alteracoes, [], ...criticas].map(l => l.map(csv).join(";"));

    baixar(`﻿${linhas.join("\r\n")}\r\n`, `${nomeBase()}_log.csv`, "text/csv;charset=utf-8");
}

// ============================================================
// Eventos
// ============================================================
el.dropZone.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("click", e => e.stopPropagation());
el.fileInput.addEventListener("change", () => {
    carregarArquivo(el.fileInput.files[0]);
    el.fileInput.value = "";
});

el.dropZone.addEventListener("dragover", e => {
    e.preventDefault();
    el.dropZone.classList.add("dragover");
});
el.dropZone.addEventListener("dragleave", () => el.dropZone.classList.remove("dragover"));
el.dropZone.addEventListener("drop", e => {
    e.preventDefault();
    el.dropZone.classList.remove("dragover");
    carregarArquivo(e.dataTransfer.files[0]);
});

el.btnProg.addEventListener("click", () => exportarArquivo("prog"));
el.btnEscala.addEventListener("click", () => exportarArquivo("escala"));
el.btnLog.addEventListener("click", exportarLog);
