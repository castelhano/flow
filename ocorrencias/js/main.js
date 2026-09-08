const MDBReader = MDBReaderLib.MDBReader;

// ============================================================
// Estado
// ============================================================
const state = {
    rows: [],        // linhas de OCORRENCIAS já filtradas pelo período [{ Data, Tipo }]
    groups: [],       // [{ key, label, count, checked }]
    inicioUTC: null,
    fimUTC: null,
    lastCsv: null,     // { headers: [...], rows: [[...], ...] } — espelha a última tabela gerada
};

// Tipos que já vêm marcados por padrão (chave normalizada — ver normalizeTipo)
const DEFAULT_CHECKED_KEYS = new Set(["recolhida anormal", "socorro", "faltas"]);

// ============================================================
// DOM refs
// ============================================================
const el = {
    inicio: document.getElementById("input-inicio"),
    fim: document.getElementById("input-fim"),
    dropZone: document.getElementById("drop-accdb"),
    fileInput: document.getElementById("input-accdb"),
    btnCarregar: document.getElementById("btn-carregar"),
    statusBadge: document.getElementById("status-badge"),

    sectionTipos: document.getElementById("section-tipos"),
    statDias: document.getElementById("stat-dias"),
    statTotal: document.getElementById("stat-total"),
    statTipos: document.getElementById("stat-tipos"),
    tipoGrid: document.getElementById("tipo-grid"),
    linkMarcar: document.getElementById("link-marcar-todos"),
    linkDesmarcar: document.getElementById("link-desmarcar-todos"),
    btnGerar: document.getElementById("btn-gerar"),

    sectionResultado: document.getElementById("section-resultado"),
    resultHead: document.getElementById("result-head"),
    resultBody: document.getElementById("result-body"),
    btnCsv: document.getElementById("btn-csv"),

    loader: document.getElementById("loader"),
    loaderText: document.getElementById("loader-text"),
};

// ============================================================
// Utilitários de data (tudo em UTC para não deslocar o dia)
// ============================================================
function parseDateInputUTC(value) {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
}

function dateKeyUTC(date) {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatDateBR(ms) {
    const d = new Date(ms);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function listaDiasUTC(inicioUTC, fimUTC) {
    const dias = [];
    for (let t = inicioUTC; t <= fimUTC; t += 86400000) dias.push(t);
    return dias;
}

// ============================================================
// Normalização de Tipo — agrupa variações de grafia/acentuação
// e força "Falta Condutor" / "Falta CondutorA" em uma única coluna
// ============================================================
function normalizeTipo(raw) {
    const clean = raw == null ? "" : String(raw).trim();
    if (!clean) return { key: "_vazio", forcedLabel: "(Sem tipo)" };

    const folded = clean
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    if (folded.startsWith("falta condutor")) {
        return { key: "faltas", forcedLabel: "Faltas" };
    }
    return { key: folded, forcedLabel: null, rawLabel: clean };
}

function buildGroups(rows) {
    const meta = new Map(); // key -> { count, forcedLabel, labelCounts: Map }

    for (const row of rows) {
        const { key, forcedLabel, rawLabel } = normalizeTipo(row.Tipo);
        if (!meta.has(key)) meta.set(key, { count: 0, forcedLabel, labelCounts: new Map() });
        const m = meta.get(key);
        m.count++;
        if (!forcedLabel) {
            m.labelCounts.set(rawLabel, (m.labelCounts.get(rawLabel) || 0) + 1);
        }
    }

    const groups = [];
    for (const [key, m] of meta) {
        let label = m.forcedLabel;
        if (!label) {
            let best = null, bestCount = -1;
            for (const [l, c] of m.labelCounts) {
                if (c > bestCount) { best = l; bestCount = c; }
            }
            label = best;
        }
        groups.push({ key, label, count: m.count, checked: DEFAULT_CHECKED_KEYS.has(key) });
    }

    groups.sort((a, b) => {
        const ad = DEFAULT_CHECKED_KEYS.has(a.key) ? 0 : 1;
        const bd = DEFAULT_CHECKED_KEYS.has(b.key) ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return b.count - a.count;
    });

    return groups;
}

// ============================================================
// Drop-zone
// ============================================================
el.dropZone.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("click", e => e.stopPropagation());
el.fileInput.addEventListener("change", () => {
    const file = el.fileInput.files[0];
    if (!file) return;
    el.dropZone.classList.add("loaded");
    el.dropZone.querySelector("p").textContent = file.name;
});

// ============================================================
// ETAPA 01 -> 02: carregar e analisar
// ============================================================
el.btnCarregar.addEventListener("click", async () => {
    const inicioVal = el.inicio.value;
    const fimVal = el.fim.value;
    const file = el.fileInput.files[0];

    if (!inicioVal || !fimVal) {
        alert("Informe início e fim do período.");
        return;
    }
    if (!file) {
        alert("Selecione o arquivo .accdb.");
        return;
    }

    const inicioUTC = parseDateInputUTC(inicioVal);
    const fimUTC = parseDateInputUTC(fimVal);
    if (inicioUTC > fimUTC) {
        alert("A data de início não pode ser depois da data de fim.");
        return;
    }

    showLoader("Lendo base de dados...");
    try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const reader = new MDBReader(buffer);
        const table = reader.getTable("OCORRENCIAS");
        const allRows = table.getData({ columns: ["Data", "Tipo"] });

        const rows = allRows.filter(r => {
            if (!(r.Data instanceof Date)) return false;
            const k = dateKeyUTC(r.Data);
            return k >= inicioUTC && k <= fimUTC;
        });

        state.rows = rows;
        state.inicioUTC = inicioUTC;
        state.fimUTC = fimUTC;
        state.groups = buildGroups(rows);

        renderTipos();

        el.statusBadge.textContent = `${file.name} — ${rows.length.toLocaleString("pt-BR")} ocorrências no período`;
        el.sectionTipos.classList.remove("hidden");
        el.sectionResultado.classList.add("hidden");
        el.sectionTipos.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
        console.error(err);
        alert("Não foi possível ler o arquivo. Verifique se é um .accdb/.mdb válido e se contém a tabela OCORRENCIAS.\n\n" + err.message);
        el.statusBadge.textContent = "Falha ao ler arquivo";
    } finally {
        hideLoader();
    }
});

// ============================================================
// ETAPA 02: render dos chips de tipo
// ============================================================
function renderTipos() {
    const dias = listaDiasUTC(state.inicioUTC, state.fimUTC).length;
    el.statDias.textContent = dias.toLocaleString("pt-BR");
    el.statTotal.textContent = state.rows.length.toLocaleString("pt-BR");
    el.statTipos.textContent = state.groups.length.toLocaleString("pt-BR");

    el.tipoGrid.innerHTML = "";
    for (const g of state.groups) {
        const label = document.createElement("label");
        label.className = "tipo-chip";
        label.innerHTML = `
            <input type="checkbox" data-key="${g.key}" ${g.checked ? "checked" : ""}>
            <span>${g.label}</span>
            <span class="tipo-count">(${g.count.toLocaleString("pt-BR")})</span>
        `;
        el.tipoGrid.appendChild(label);
    }
}

el.linkMarcar.addEventListener("click", e => {
    e.preventDefault();
    el.tipoGrid.querySelectorAll("input[type=checkbox]").forEach(cb => cb.checked = true);
});
el.linkDesmarcar.addEventListener("click", e => {
    e.preventDefault();
    el.tipoGrid.querySelectorAll("input[type=checkbox]").forEach(cb => cb.checked = false);
});

// ============================================================
// ETAPA 02 -> 03: gerar matriz data x tipo
// ============================================================
el.btnGerar.addEventListener("click", () => {
    const checkboxes = [...el.tipoGrid.querySelectorAll("input[type=checkbox]")];
    const selectedKeys = checkboxes.filter(cb => cb.checked).map(cb => cb.dataset.key);

    if (!selectedKeys.length) {
        alert("Selecione ao menos um tipo de ocorrência.");
        return;
    }

    const selectedGroups = state.groups.filter(g => selectedKeys.includes(g.key));

    // conta ocorrências por dia x tipo
    const dayMap = new Map(); // dateKeyUTC -> { [tipoKey]: count }
    for (const row of state.rows) {
        if (!(row.Data instanceof Date)) continue;
        const { key } = normalizeTipo(row.Tipo);
        if (!selectedKeys.includes(key)) continue;
        const dKey = dateKeyUTC(row.Data);
        if (!dayMap.has(dKey)) dayMap.set(dKey, {});
        const bucket = dayMap.get(dKey);
        bucket[key] = (bucket[key] || 0) + 1;
    }

    const dias = listaDiasUTC(state.inicioUTC, state.fimUTC);
    const headers = ["Data", ...selectedGroups.map(g => g.label)];
    const rows = dias.map(dKey => {
        const bucket = dayMap.get(dKey) || {};
        return [formatDateBR(dKey), ...selectedGroups.map(g => bucket[g.key] || 0)];
    });

    state.lastCsv = { headers, rows };
    renderResultado(headers, rows);

    el.sectionResultado.classList.remove("hidden");
    el.sectionResultado.scrollIntoView({ behavior: "smooth", block: "start" });
});

function renderResultado(headers, rows) {
    el.resultHead.innerHTML = headers.map(h => `<th>${h}</th>`).join("");
    el.resultBody.innerHTML = rows.map(row => {
        const [data, ...valores] = row;
        return `<tr><td class="td-main">${data}</td>${valores.map(v => `<td>${v}</td>`).join("")}</tr>`;
    }).join("");
}

// ============================================================
// Download CSV
// ============================================================
el.btnCsv.addEventListener("click", () => {
    if (!state.lastCsv) return;
    const { headers, rows } = state.lastCsv;

    const escape = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = [headers, ...rows];
    const csv = linhas.map(row => row.map(escape).join(";")).join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const inicioStr = formatDateBR(state.inicioUTC).replace(/\//g, "_");
    const fimStr = formatDateBR(state.fimUTC).replace(/\//g, "_");
    a.href = url;
    a.download = `ocorrencias_${inicioStr}_a_${fimStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
});

// ============================================================
// Loader
// ============================================================
function showLoader(texto) {
    el.loaderText.textContent = texto;
    el.loader.classList.remove("hidden");
}
function hideLoader() {
    el.loader.classList.add("hidden");
}
