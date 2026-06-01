// ============================================================
// UIController.js — Renderização e interação com o DOM
//
// Responsabilidade única: manipular o DOM a partir dos dados
// processados pelo Engine. Não contém lógica de negócio.
// ============================================================

const UIController = {

    // ----------------------------------------------------------
    // ESTADO INTERNO (resultado atual para download)
    // ----------------------------------------------------------
    _lastResult: null,


    // ----------------------------------------------------------
    // UTILITÁRIOS DE VISIBILIDADE
    // ----------------------------------------------------------
    showElement(id) { document.getElementById(id)?.classList.remove('hidden'); },
    hideElement(id) { document.getElementById(id)?.classList.add('hidden'); },

    showLoader(text) {
        document.getElementById('loader-text').textContent = text || 'Processando...';
        UIController.showElement('loader');
    },

    hideLoader() {
        UIController.hideElement('loader');
    },

    setStatusBadge(text, type) {
        const el = document.getElementById('status-badge');
        if (!el) return;
        el.textContent = text;
        el.style.color = {
            ok:      'var(--success)',
            warn:    'var(--warning)',
            error:   'var(--danger)',
            default: 'var(--text-3)'
        }[type || 'default'];
    },


    // ----------------------------------------------------------
    // ETAPA 1 — CHIPS DE ARQUIVOS CARREGADOS
    // ----------------------------------------------------------
    renderFileChip(entityName, rowCount, hasFk, onRemove) {
        const chips = document.getElementById('files-chips');
        if (!chips) return;

        // Remove chip anterior da mesma entidade se existir
        const existing = chips.querySelector(`[data-entity="${entityName}"]`);
        if (existing) existing.remove();

        const chip = document.createElement('div');
        chip.className = 'file-chip' + (hasFk ? ' has-fk' : '');
        chip.dataset.entity = entityName;
        chip.innerHTML = `
            <span class="file-chip-name">${entityName}</span>
            <span class="file-chip-rows">${rowCount} linhas</span>
            <button class="file-chip-remove" title="Remover">
                <i data-lucide="x"></i>
            </button>
        `;

        chip.querySelector('.file-chip-remove').addEventListener('click', e => {
            e.stopPropagation();
            chip.remove();
            if (onRemove) onRemove(entityName);
        });

        chips.appendChild(chip);
        lucide.createIcons({ nodes: [chip] });

        UIController.showElement('files-list');
    },


    // ----------------------------------------------------------
    // ETAPA 2 — SCHEMA DETECTADO
    // ----------------------------------------------------------
    renderSchema(schema) {
        const grid = document.getElementById('schema-grid');
        if (!grid) return;
        grid.innerHTML = '';

        for (const entity of schema) {
            const card = document.createElement('div');
            card.className = 'schema-card';

            const fieldsHtml = entity.fields.map(f => `
                <div class="schema-field">
                    <i data-lucide="minus"></i>
                    <span>${f}</span>
                </div>
            `).join('');

            // Arrays que este pai vai conter
            const aggregatesHtml = entity.aggregates.map(a => `
                <div class="schema-field is-fk">
                    <i data-lucide="list"></i>
                    <span>${a.childName}[]</span>
                    <span class="schema-fk-target">via ${a.fieldName}</span>
                </div>
            `).join('');

            // Informa de quem é filho (FK)
            const parentHtml = entity.parentOf.length ? `
                <div class="schema-field" style="color:var(--text-3); margin-top:4px;">
                    <i data-lucide="corner-right-up"></i>
                    <span>filho de ${entity.parentOf.join(', ')}</span>
                </div>
            ` : '';

            card.innerHTML = `
                <div class="schema-card-header">
                    <i data-lucide="table-2"></i>
                    <span class="schema-entity-name">${entity.name}</span>
                    <span class="schema-row-count">${entity.rowCount} linhas</span>
                </div>
                <div class="schema-card-body">
                    ${fieldsHtml}
                    ${aggregatesHtml}
                    ${parentHtml}
                </div>
            `;

            grid.appendChild(card);
        }

        lucide.createIcons({ nodes: [grid] });
        UIController.showElement('section-schema');
    },


    // ----------------------------------------------------------
    // ETAPA 3 — RESULTADO
    // ----------------------------------------------------------
    renderResult(result, schema) {
        UIController._lastResult = result;

        const grid = document.getElementById('result-grid');
        if (!grid) return;
        grid.innerHTML = '';

        for (const entity of schema) {
            const rows  = result[entity.name] || [];
            const card  = document.createElement('div');
            card.className = 'result-card';

            const preview = UIController._buildPreview(rows);

            card.innerHTML = `
                <div class="result-card-header">
                    <i data-lucide="file-json"></i>
                    <span class="result-entity-name">${entity.name}</span>
                    <span class="result-count">${rows.length} registros</span>
                </div>
                <div class="result-card-body">
                    <div class="result-preview">${preview}</div>
                </div>
                <div class="result-card-footer">
                    <button class="btn btn-ghost" data-entity="${entity.name}" style="height:28px; font-size:10px;">
                        <i data-lucide="download"></i> JSON
                    </button>
                </div>
            `;

            card.querySelector('[data-entity]').addEventListener('click', e => {
                const name = e.currentTarget.dataset.entity;
                UIController._downloadJSON(result[name], name);
            });

            grid.appendChild(card);
        }

        lucide.createIcons({ nodes: [grid] });
        UIController.showElement('section-result');
        UIController.showElement('btn-download-all');
    },


    // ----------------------------------------------------------
    // AVISOS DO ENGINE
    // ----------------------------------------------------------
    showWarnings(warnings) {
        if (!warnings.length) return;

        const msg = warnings.length === 1
            ? warnings[0]
            : `${warnings.length} avisos:\n\n` + warnings.map((w, i) => `${i + 1}. ${w}`).join('\n');

        console.warn('[csv_weave]', msg);
        UIController.setStatusBadge(`${warnings.length} aviso(s) — veja o console`, 'warn');
    },


    // ----------------------------------------------------------
    // DOWNLOAD ZIP COM TODAS AS ENTIDADES
    // ----------------------------------------------------------
    async downloadZIP() {
        const result = UIController._lastResult;
        if (!result) return;

        if (typeof JSZip === 'undefined') {
            alert('JSZip não carregado — faça o download individualmente.');
            return;
        }

        const zip = new JSZip();
        for (const [name, rows] of Object.entries(result)) {
            zip.file(`${name}.json`, JSON.stringify(rows, null, 2));
        }

        const blob     = await zip.generateAsync({ type: 'blob' });
        const url      = URL.createObjectURL(blob);
        const a        = document.createElement('a');
        a.href         = url;
        a.download     = `csv_weave_${UIController._dateTag()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
    },


    // ----------------------------------------------------------
    // HELPERS PRIVADOS
    // ----------------------------------------------------------
    _downloadJSON(data, name) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `${name}_${UIController._dateTag()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    _dateTag() {
        const d = new Date();
        return [
            d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0')
        ].join('_');
    },

    // Gera HTML de preview JSON com syntax highlighting simples
    _buildPreview(rows) {
        const maxRows = APP_CONFIG.ui.previewMaxRows;
        const preview = rows.slice(0, maxRows);

        const esc  = s => String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const colorize = (val) => {
            if (val === null)              return `<span class="json-null">null</span>`;
            if (typeof val === 'number')   return `<span class="json-number">${val}</span>`;
            if (typeof val === 'object')   return `<span class="json-key">{…}</span>`;
            return `<span class="json-string">"${esc(val)}"</span>`;
        };

        const lines = preview.map(obj => {
            const pairs = Object.entries(obj).map(([k, v]) => {
                const key   = `<span class="json-key">"${esc(k)}"</span>`;
                const value = colorize(v);
                return `  ${key}: ${value}`;
            });
            return `{\n${pairs.join(',\n')}\n}`;
        });

        const suffix = rows.length > maxRows
            ? `\n// ... mais ${rows.length - maxRows} registros`
            : '';

        return lines.join(',\n') + suffix;
    }
};
