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
