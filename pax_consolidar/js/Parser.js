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
                    console.log("[DEBUG Parser.readCSV]", file.name,
                        "| encoding:", encoding,
                        "| linhas totais (com cabeçalho):", data.length,
                        "| colunas na 1a linha:", data[0] ? data[0].length : 0,
                        "| cabeçalho:", data[0],
                        "| erros PapaParse:", results.errors?.length || 0, results.errors?.slice(0, 3));
                    if (data.length > 0) data.shift(); // Remove cabeçalho
                    console.log("[DEBUG Parser.readCSV]", file.name, "| amostra linha 0 pós-shift:", data[0]);
                    resolve(data);
                },
                error: (err) => reject(new Error(`Erro ao ler CSV: ${err.message}`))
            });
        });
    }
}
