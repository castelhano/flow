// ============================================================
// DataNormalizer.js — Normalização de dados brutos
//
// Responsabilidade única: receber uma linha crua do CSV e
// devolver um objeto limpo com campos semânticos e valores
// canônicos conforme definido no settings.js
//
// Não conhece o Engine, não conhece a UI.
// ============================================================

class DataNormalizer {

    // configOrigem é APP_CONFIG.fontes.gps ou APP_CONFIG.fontes.bilhetagem
    constructor(configOrigem) {
        this.config  = configOrigem;
        this.mapping = this._letrasParaIndices(configOrigem.colunas);
    }


    // ----------------------------------------------------------
    // Normaliza uma linha crua (array de valores do CSV)
    // Retorna objeto com campos semânticos e valores canônicos
    // ----------------------------------------------------------
    normalize(rawRow) {
        const clean = {};

        // Extrai cada campo pelo índice da coluna mapeada
        for (const field in this.mapping) {
            const valor = rawRow[this.mapping[field]];
            clean[field] = valor !== undefined && valor !== null
                ? String(valor).trim()
                : "";
        }

        // Normaliza empresa → valor canônico
        const normEmpresa = this.config.normalizacao?.empresa;
        if (normEmpresa && clean.empresa && normEmpresa[clean.empresa]) {
            clean.empresa = normEmpresa[clean.empresa];
        }

        // Preserva valor bruto antes de normalizar
        clean.linha_raw = clean.linha;

        // Normaliza linha → valor canônico
        const normLinha = this.config.normalizacao?.linha;
        if (normLinha && clean.linha && normLinha[clean.linha]) {
            clean.linha = normLinha[clean.linha];
        }

        // Normaliza veículo → valor canônico
        const normVeiculo = this.config.normalizacao?.veiculo;
        if (normVeiculo && clean.veiculo && normVeiculo[clean.veiculo]) {
            clean.veiculo = normVeiculo[clean.veiculo];
        }

        // Decompõe linha em linha_base e sentido
        // Formato esperado: "A14 - IDA" → linha_base: "A14", sentido: "IDA"
        // Sem separador → sentido: "UNICO"
        if (clean.linha && clean.linha.includes(' - ')) {
            const partes      = clean.linha.split(' - ');
            clean.linha_base  = partes[0].trim();
            clean.sentido     = partes[1].trim().toUpperCase();
        } else {
            clean.linha_base  = clean.linha;
            clean.sentido     = "UNICO";
        }

        return clean;
    }


    // ----------------------------------------------------------
    // Converte letras de coluna ("A", "B", "AA"...) em índices numéricos
    // "A" → 0, "B" → 1, "Z" → 25, "AA" → 26
    // Aceita tanto string ("A") quanto objeto ({ coluna: "A", ... })
    // ----------------------------------------------------------
    _letrasParaIndices(colunas) {
        const map = {};
        for (const field in colunas) {
            const def   = colunas[field];
            const letra = (typeof def === "object" ? def.coluna : def).toUpperCase();
            map[field]  = DataNormalizer._letraParaIndice(letra);
        }
        return map;
    }

    // Converte uma letra de coluna em índice numérico (0-based)
    static _letraParaIndice(letra) {
        let n = 0;
        const upper = String(letra).toUpperCase();
        for (let i = 0; i < upper.length; i++) {
            n = n * 26 + upper.charCodeAt(i) - 64;
        }
        return n - 1;
    }
}


// ----------------------------------------------------------
// Validação básica do CSV — lê a primeira linha de dados
// e verifica se os campos esperados estão nas colunas certas.
// Lança Error com mensagem amigável se inválido.
// Fica aqui (e não no main.js) porque a página de revisão também usa,
// pelo PaxCorte.validar.
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
