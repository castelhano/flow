// ============================================================
// Engine.js — Motor de conversão CSV → JSON estruturado
//
// Lógica:
//   1. Detecta colunas FK (padrão "entidade.campo") em cada arquivo
//   2. Processa filhos primeiro (ordem topo invertida)
//   3. Agrupa linhas de filhos por valor FK → childIndex
//   4. Injeta os arrays no pai quando for sua vez
//   5. Colunas FK são descartadas — nunca aparecem no resultado
//
// Resultado: objeto pai contém array de filhos já resolvidos,
// sem nenhuma referência de volta ao pai.
// ============================================================

class Engine {

    // filesData: { entityName → { entityName, headers, rows } }
    constructor(filesData) {
        this._filesData = filesData;
    }


    // ----------------------------------------------------------
    // PONTO DE ENTRADA PÚBLICO
    // Retorna { result, schema, warnings }
    // ----------------------------------------------------------
    process() {
        const entities = this._parseEntities();
        const warnings = this._validate(entities);

        // Filhos primeiro → pais por último
        const order = this._topoSort(entities).reverse();

        // childIndex[parentName][childName][fkFieldName][fkValue] = [childObjects]
        const childIndex = {};
        const result     = {};

        for (const name of order) {
            const entity    = entities[name];
            const myChildren = childIndex[name] || {};

            const rows = entity.rows.map((raw, i) => {
                const obj = {};

                // Campos diretos — FK columns são ignoradas aqui
                for (const col of entity.directCols) {
                    obj[col.out] = raw[col.src] ?? '';
                }

                // Injeta arrays de filhos que já foram processados
                for (const [childName, byField] of Object.entries(myChildren)) {
                    for (const [fieldName, byValue] of Object.entries(byField)) {
                        const myVal = String(obj[fieldName] ?? '').trim();
                        obj[childName] = byValue[myVal] || [];
                    }
                }

                return obj;
            });

            result[name] = rows;

            // Registra este objeto no childIndex do seu pai
            for (const fk of entity.fkCols) {
                if (!entities[fk.entityName]) continue;

                const ci = childIndex;
                if (!ci[fk.entityName])                              ci[fk.entityName] = {};
                if (!ci[fk.entityName][name])                        ci[fk.entityName][name] = {};
                if (!ci[fk.entityName][name][fk.fieldName])          ci[fk.entityName][name][fk.fieldName] = {};

                rows.forEach((obj, i) => {
                    const rawVal = String(entity.rows[i][fk.header] ?? '').trim();
                    const bucket = ci[fk.entityName][name][fk.fieldName];
                    if (!bucket[rawVal]) bucket[rawVal] = [];
                    bucket[rawVal].push(obj);
                });
            }
        }

        // Schema é exibido na ordem natural (pais primeiro)
        const schemaOrder = this._topoSort(entities);
        return {
            result,
            schema:   this._buildSchema(entities, schemaOrder),
            warnings
        };
    }


    // ----------------------------------------------------------
    // PRIVADOS
    // ----------------------------------------------------------

    _parseEntities() {
        const entities = {};

        for (const [name, file] of Object.entries(this._filesData)) {
            const directCols = [];
            const fkCols     = [];

            for (const header of file.headers) {
                const trimmed = header.trim();
                if (!trimmed) continue;

                const match = trimmed.match(/^(\w+)\.(\w+)$/);
                if (match) {
                    fkCols.push({
                        header,                  // chave no objeto PapaParse
                        entityName: match[1],
                        fieldName:  match[2]
                    });
                } else {
                    directCols.push({
                        src: header,             // chave original no objeto PapaParse
                        out: trimmed             // chave no JSON final
                    });
                }
            }

            entities[name] = { name, rows: file.rows, directCols, fkCols };
        }

        return entities;
    }


    _topoSort(entities) {
        const visited = new Set();
        const order   = [];

        const visit = (name) => {
            if (visited.has(name)) return;
            visited.add(name);
            const entity = entities[name];
            if (!entity) return;
            for (const fk of entity.fkCols) {
                if (entities[fk.entityName]) visit(fk.entityName);
            }
            order.push(name);
        };

        for (const name of Object.keys(entities)) visit(name);
        return order;
    }


    _validate(entities) {
        const warnings = [];
        for (const [name, entity] of Object.entries(entities)) {
            for (const fk of entity.fkCols) {
                if (!entities[fk.entityName]) {
                    warnings.push(
                        `"${name}" referencia "${fk.entityName}" (coluna "${fk.header}") mas o arquivo não foi carregado.`
                    );
                }
            }
        }
        return warnings;
    }


    // Monta descrição estrutural para exibição na Etapa 2
    // aggregates = quais filhos cada entidade vai conter
    _buildSchema(entities, order) {
        // Mapa reverso: parentName → [{ childName, fieldName }]
        const aggregates = {};
        for (const [name, entity] of Object.entries(entities)) {
            for (const fk of entity.fkCols) {
                if (!aggregates[fk.entityName]) aggregates[fk.entityName] = [];
                aggregates[fk.entityName].push({ childName: name, fieldName: fk.fieldName });
            }
        }

        return order.map(name => {
            const e = entities[name];
            return {
                name,
                rowCount:   e.rows.length,
                fields:     e.directCols.map(c => c.out),
                aggregates: aggregates[name] || [],
                // informa de quem é filho (para exibição no card)
                parentOf:   e.fkCols.map(fk => fk.entityName).filter(p => entities[p])
            };
        });
    }
}
