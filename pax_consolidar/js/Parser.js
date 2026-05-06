// ============================================================
// Parser.js — Leitura de arquivos de entrada
//
// Responsabilidade única: ler um arquivo do disco/input e
// devolver um array de linhas brutas (arrays de strings).
//
// Não normaliza, não conhece o modelo de dados.
// Depende de PapaParse (vendor/papaparse.min.js).
// ============================================================

class Parser {

    // ----------------------------------------------------------
    // Lê um arquivo CSV e retorna array de linhas brutas
    // Remove automaticamente a linha de cabeçalho (índice 0)
    // Encoding padrão ISO-8859-1 para compatibilidade com exports brasileiros
    // ----------------------------------------------------------
    static readCSV(file, encoding = "ISO-8859-1") {
        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header:         false,
                skipEmptyLines: true,
                encoding,
                complete: (results) => {
                    const data = results.data;
                    if (data.length > 0) data.shift(); // Remove cabeçalho
                    resolve(data);
                },
                error: (err) => reject(new Error(`Erro ao ler CSV: ${err.message}`))
            });
        });
    }
}
