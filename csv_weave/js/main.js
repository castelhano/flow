// ============================================================
// main.js — Orquestração de eventos do CSV Weave
//
// Responsabilidade: conectar eventos da UI ao Parser e Engine.
// Não contém lógica de negócio nem manipulação de DOM além
// do estritamente necessário para coordenar o fluxo.
// ============================================================

// Estado global — único objeto mutável da aplicação
const AppState = {
    // { entityName → { entityName, headers, rows } }
    filesData: {}
};


// ----------------------------------------------------------
// ADICIONAR ARQUIVOS
// Chamado pelo index.html ao detectar novos arquivos
// ----------------------------------------------------------
async function handleFilesAdded(files) {
    const encoding = document.getElementById('select-encoding').value;

    UIController.showLoader('Lendo arquivos...');

    try {
        const parsed = await Parser.readAll(files, encoding);

        for (const fileData of parsed) {
            AppState.filesData[fileData.entityName] = fileData;
        }

        _refreshUI();
    } catch (err) {
        UIController.setStatusBadge('Erro ao ler arquivo', 'error');
        alert(err.message);
    } finally {
        UIController.hideLoader();
    }
}


// ----------------------------------------------------------
// REMOVER ARQUIVO
// Chamado pelo chip quando o usuário clica em ×
// ----------------------------------------------------------
function handleFileRemoved(entityName) {
    delete AppState.filesData[entityName];
    _refreshUI();
}


// ----------------------------------------------------------
// EXECUTAR ENGINE
// ----------------------------------------------------------
function runEngine() {
    const count = Object.keys(AppState.filesData).length;
    if (!count) return;

    UIController.showLoader('Convertendo...');

    // setTimeout para permitir que o loader renderize antes do
    // processamento síncrono do Engine bloquear a thread
    setTimeout(() => {
        try {
            const engine = new Engine(AppState.filesData);
            const { result, schema, warnings } = engine.process();

            UIController.renderResult(result, schema);

            if (warnings.length) {
                UIController.showWarnings(warnings);
            } else {
                UIController.setStatusBadge(
                    `${count} entidade(s) convertida(s)`, 'ok'
                );
            }
        } catch (err) {
            UIController.setStatusBadge('Erro no processamento', 'error');
            alert(`Erro durante a conversão:\n\n${err.message}`);
            console.error(err);
        } finally {
            UIController.hideLoader();
        }
    }, 60);
}


// ----------------------------------------------------------
// ATUALIZA UI COM BASE NO ESTADO ATUAL
// ----------------------------------------------------------
function _refreshUI() {
    const filesData = AppState.filesData;
    const count     = Object.keys(filesData).length;

    // Recria todos os chips a partir do estado (evita dessync)
    const chips = document.getElementById('files-chips');
    if (chips) chips.innerHTML = '';

    if (!count) {
        UIController.hideElement('files-list');
        UIController.hideElement('section-schema');
        UIController.hideElement('section-result');
        UIController.hideElement('btn-converter');
        UIController.setStatusBadge('Aguardando arquivos...', 'default');
        return;
    }

    // Detecta FKs antes de renderizar chips (para colorir os que têm relação)
    const entityNames = new Set(Object.keys(filesData));
    for (const [name, fileData] of Object.entries(filesData)) {
        const hasFk = fileData.headers.some(h => /^\w+\.\w+$/.test(h.trim()));
        UIController.renderFileChip(name, fileData.rows.length, hasFk, handleFileRemoved);
    }

    // Calcula schema (sem resolver FKs — apenas estrutural) para a Etapa 2
    const engine = new Engine(filesData);
    const { schema } = engine.process();
    UIController.renderSchema(schema);

    UIController.showElement('btn-converter');
    UIController.setStatusBadge(
        `${count} arquivo(s) carregado(s) — pronto para converter`, 'default'
    );

    // Oculta resultado anterior se mudou os arquivos
    UIController.hideElement('section-result');
}
