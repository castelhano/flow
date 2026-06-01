// ============================================================
// Parser.js — Leitura de arquivos CSV
//
// Responsabilidade única: ler um arquivo CSV e devolver
// { entityName, headers, rows } onde:
//   entityName = nome do arquivo sem extensão (lowercase)
//   headers    = array de strings com os nomes das colunas
//   rows       = array de objetos { header: valor, ... }
//
// Depende de PapaParse (vendor/papaparse.min.js).
// ============================================================

class Parser {

    static readCSV(file, encoding = 'UTF-8') {
        const entityName = file.name.replace(/\.csv$/i, '').toLowerCase().trim();

        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header:         true,
                skipEmptyLines: true,
                encoding,
                complete: (results) => {
                    resolve({
                        entityName,
                        headers: results.meta.fields || [],
                        rows:    results.data
                    });
                },
                error: (err) => reject(new Error(`Erro ao ler "${file.name}": ${err.message}`))
            });
        });
    }

    static readAll(files, encoding) {
        encoding = encoding || APP_CONFIG.parser.encoding;
        return Promise.all(Array.from(files).map(f => Parser.readCSV(f, encoding)));
    }
}
