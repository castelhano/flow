// ============================================================
// UIController.js — Camada de apresentação
//
// Responsabilidade: ler o Session e atualizar o DOM.
// Não contém lógica de negócio — não conhece o Engine.
//
// Todos os métodos são puros do ponto de vista de dados:
// recebem o que precisam renderizar como parâmetro.
// Leem AppState.session apenas quando necessário para filtros
// e buscas que operam sobre o estado atual.
// ============================================================

const UIController = {

    // ==========================================================
    // LOADER
    // ==========================================================

    showLoader(texto = "Processando...") {
        const loader = document.getElementById("loader");
        loader.querySelector("p").innerText = texto;
        loader.classList.remove("hidden");
    },

    hideLoader() {
        document.getElementById("loader").classList.add("hidden");
    },


    // ==========================================================
    // STATUS BADGE
    // ==========================================================

    // tipo: "muted" | "success" | "danger" | "primary"
    setStatusBadge(texto, tipo = "muted") {
        const badge = document.getElementById("status-badge");
        badge.innerText = texto;
        badge.style.color = `var(--${tipo})`;
    },


    // ==========================================================
    // VISIBILIDADE DE ELEMENTOS
    // ==========================================================

    showElement(id) {
        document.getElementById(id)?.classList.remove("hidden");
    },

    hideElement(id) {
        document.getElementById(id)?.classList.add("hidden");
    },


    // ==========================================================
    // FUNCIONALIDADES DISPONÍVEIS
    // Exibe/oculta seções conforme arquivos carregados
    // ==========================================================

    atualizarFuncionalidadesDisponiveis() {
        const temGps = !!AppState.rawGps;
        const temPax = !!AppState.rawPax;

        // Botão processar só aparece com GPS (bilhetagem é opcional)
        if (temGps) this.showElement("btn-processar");

        // Seção de operações só com GPS processado
        // (será exibida pelo updateDashboard após processamento)
    },


    // ==========================================================
    // SELETOR DE EMPRESAS
    // ==========================================================

    // Modo primeiro carregamento: dois paineis (pax + conciliação)
    showSeletorEmpresas({ empresasPax, empresasGps, onConciliar }) {
        const section = document.getElementById("company-selector-section");

        document.getElementById("selector-etapa-num").innerText   = "ETAPA 01";
        document.getElementById("selector-etapa-title").innerText = "Configurar operadoras";
        document.getElementById("painel-pax-corte").classList.remove("hidden");

        const empresasCfg = APP_CONFIG.empresas || {};

        const checkItem = (cls, val, checked) =>
            `<label style="display:flex;gap:8px;cursor:pointer;align-items:center;">
                <input type="checkbox" class="${cls}" value="${val}"${checked ? " checked" : ""}> ${val}
             </label>`;

        document.getElementById("checkboxes-pax").innerHTML =
            empresasPax.map(e => {
                const cfg = Object.values(empresasCfg).find(c => c.nome === e);
                const checked = cfg ? cfg.defCorte === true : false;
                return checkItem("company-pax-select", e, checked);
            }).join("");

        document.getElementById("checkboxes-conciliacao").innerHTML =
            empresasGps.map(e => {
                const cfg = Object.values(empresasCfg).find(c => c.nome === e);
                const checked = cfg ? cfg.defConciliacao === true : false;
                return checkItem("company-conc-select", e, checked);
            }).join("");

        section.classList.remove("hidden");
        lucide.createIcons();

        document.getElementById("btn-conciliar").onclick = () => {
            const empresasPaxSel = Array.from(
                document.querySelectorAll(".company-pax-select:checked")
            ).map(cb => cb.value);

            const empresasConcSel = Array.from(
                document.querySelectorAll(".company-conc-select:checked")
            ).map(cb => cb.value);

            if (empresasPaxSel.length === 0)
                return alert("Selecione ao menos uma empresa no bloco de passageiros.");
            if (empresasConcSel.length === 0)
                return alert("Selecione ao menos uma empresa para conciliar.");

            // Esconde só o painel de corte — painel de conciliação fica visível
            document.getElementById("painel-pax-corte").classList.add("hidden");
            document.getElementById("selector-etapa-num").innerText   = "CONCILIAÇÃO";
            document.getElementById("selector-etapa-title").innerText = "Selecionar empresas para conciliar";
            onConciliar({ empresasPax: empresasPaxSel, empresasConciliacao: empresasConcSel });
        };
    },

    // Modo pós-import: apenas painel de conciliação
    showSeletorConciliacao(empresas, onConciliar) {
        const section = document.getElementById("company-selector-section");

        document.getElementById("selector-etapa-num").innerText   = "CONCILIAÇÃO";
        document.getElementById("selector-etapa-title").innerText = "Selecionar empresas para conciliar";
        document.getElementById("painel-pax-corte").classList.add("hidden");

        const empresasCfg = APP_CONFIG.empresas || {};

        const checkItem = (val) => {
            const cfg = Object.values(empresasCfg).find(c => c.nome === val);
            const checked = cfg ? cfg.defConciliacao === true : false;
            return `<label style="display:flex;gap:8px;cursor:pointer;align-items:center;">
                <input type="checkbox" class="company-conc-select" value="${val}"${checked ? " checked" : ""}> ${val}
             </label>`;
        };

        document.getElementById("checkboxes-conciliacao").innerHTML =
            empresas.map(e => checkItem(e)).join("");

        section.classList.remove("hidden");
        lucide.createIcons();

        document.getElementById("btn-conciliar").onclick = () => {
            const selecionadas = Array.from(
                document.querySelectorAll(".company-conc-select:checked")
            ).map(cb => cb.value);

            if (selecionadas.length === 0)
                return alert("Selecione ao menos uma empresa para conciliar.");

            // Seção permanece visível para permitir novas conciliações
            onConciliar(selecionadas);
        };
    },


    // ==========================================================
    // DASHBOARD PRINCIPAL
    // Ponto de entrada após processamento ou importação
    // ==========================================================

    updateDashboard(session) {
        const r = session.resumo;

        // Estatísticas
        document.getElementById("stat-total-pax").innerText      = r.totalPax.toLocaleString();
        document.getElementById("stat-assigned-pax").innerText   = r.atribuidos.toLocaleString();
        document.getElementById("stat-unassigned-pax").innerText = r.naoAtribuidos.toLocaleString();

        const pctAtribuidos    = r.totalPax > 0 ? Math.round(r.atribuidos    / r.totalPax * 100) : 0;
        const pctNaoAtribuidos = r.totalPax > 0 ? Math.round(r.naoAtribuidos / r.totalPax * 100) : 0;
        const pctIgnorados     = r.totalPax > 0 ? Math.round(r.ignorados     / r.totalPax * 100) : 0;
        document.getElementById("stat-assigned-pct").innerText   = `${pctAtribuidos}%`;
        document.getElementById("stat-unassigned-pct").innerText = `${pctNaoAtribuidos}%`;
        document.getElementById("stat-ignorados").innerText      = r.ignorados.toLocaleString();
        document.getElementById("stat-ignorados-pct").innerText  = pctIgnorados > 0 ? `${pctIgnorados}%` : "";
        document.getElementById("stat-total-trips").innerText    = r.totalViagens.toLocaleString();
        document.getElementById("stat-total-omissoes").innerText = r.omissoes.toLocaleString();

        const badgeExc = document.getElementById("badge-excecoes");
        if (badgeExc) badgeExc.innerText = `${r.naoAtribuidos.toLocaleString()} pendentes`;

        // Exibe seções
        ["section-resumo", "section-excecoes", "suggestions-section", "section-operacoes"]
            .forEach(id => this.showElement(id));

        // Popula filtro de empresas
        this._popularFiltroEmpresas(session);

        // Renderiza tabelas — exceções apenas de empresas já conciliadas, sem linhas ignoradas
        const conciliadas  = new Set(session.empresasConciliadas || []);
        const ignoradosIds = new Set((session.paxIgnorados || []).map(p => p.id));
        this.renderExcecoes(session.passageiros.filter(p =>
            !p.assigned &&
            !ignoradosIds.has(p.id) &&
            (conciliadas.size === 0 || conciliadas.has(p.empresa))
        ));
        this.renderSugestoes(session.sugestoes);
        this.atualizarSeletorViagens();

        // Atualiza ícones lucide (caso a seção estivesse oculta)
        lucide.createIcons();
    },


    // ==========================================================
    // TABELA DE EXCEÇÕES (passageiros não atribuídos)
    // ==========================================================

    renderExcecoes(lista) {
        this._excecoesVisiveis = lista;
        const tbody = document.getElementById("table-exceptions-body");
        const limite = APP_CONFIG.ui.excecoesPorPagina;

        tbody.innerHTML = lista.slice(0, limite).map(p => `
            <tr>
                <td class="p-4">
                    <input type="checkbox" class="pax-checkbox" value="${p.id}">
                </td>
                <td>${p.horario}</td>
                <td style="color:var(--primary)">${p.empresa}</td>
                <td>${p.veiculo}</td>
                <td>${p.linha_consolidada}</td>
                <td>${p.tipo}</td>
            </tr>
        `).join("");

        // Atualiza contador ao marcar/desmarcar
        tbody.querySelectorAll(".pax-checkbox").forEach(cb => {
            cb.addEventListener("change", () => this._atualizarContadorSelecionados());
        });

        // Aviso de truncamento
        if (lista.length > limite) {
            tbody.insertAdjacentHTML("beforeend", `
                <tr>
                    <td colspan="6" style="text-align:center; color:var(--text-muted);
                        font-size:0.8rem; padding:8px;">
                        Exibindo ${limite} de ${lista.length.toLocaleString()} registros.
                        Use os filtros para refinar.
                    </td>
                </tr>
            `);
        }
    },


    // ==========================================================
    // TABELA DE SUGESTÕES (etapa C)
    // ==========================================================

    renderSugestoes(sugestoes) {
        const section = document.getElementById("suggestions-section");
        if (!sugestoes || sugestoes.length === 0) {
            section.classList.add("hidden");
            const statEl = document.getElementById("stat-sugestoes");
            if (statEl) statEl.innerText = "0";
            const badge = document.getElementById("badge-sugestoes");
            if (badge) badge.innerText = "0 pendentes";
            return;
        }

        section.classList.remove("hidden");

        // Popula e limpa filtros ao re-renderizar a lista completa
        ["sug-filter-veiculo", "sug-filter-linha"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });

        const empresasSel = document.getElementById("sug-filter-empresa");
        if (empresasSel) {
            const empresas = [...new Set(sugestoes.map(s => s.pax?.empresa).filter(Boolean))].sort();
            empresasSel.innerHTML = "<option value=''>Empresa (Todas)</option>"
                + empresas.map(e => `<option value="${e}">${e}</option>`).join("");
        }

        document.getElementById("stat-sugestoes").innerText = sugestoes.length.toLocaleString();
        const badge = document.getElementById("badge-sugestoes");
        if (badge) badge.innerText = `${sugestoes.length} pendentes`;

        this._renderSugestoesTabela(sugestoes);
    },

    _renderSugestoesTabela(sugestoes) {
        this._sugestoesVisiveis = sugestoes;
        const selectAll = document.getElementById("select-all-sugestoes");
        if (selectAll) selectAll.checked = false;

        const autoMin = APP_CONFIG.ui.confiancaAutoSelecionavel;
        const tbody   = document.getElementById("table-suggestions-body");

        const motivoLabel = {
            gap_curto:          "Terminal (gap curto)",
            gap_longo:          "Entrepico (gap longo)",
            linha_divergente:   "Linha divergente",
            veiculo_divergente: "Veículo divergente"
        };

        tbody.innerHTML = sugestoes.map(s => {
            const autoCheck  = s.confianca >= autoMin ? "checked" : "";
            const corBarra   = s.confianca >= 70 ? "var(--success)"
                             : s.confianca >= 45 ? "var(--warning)"
                             : "var(--text-muted)";
            const c = s.criterios || {};

            return `
                <tr>
                    <td class="p-4">
                        <input type="checkbox" class="sugestao-checkbox"
                            value="${s.paxId}" ${autoCheck}>
                    </td>
                    <td>${s.pax.horario}</td>
                    <td style="color:var(--primary)">${s.pax.empresa}</td>
                    <td>${s.pax.veiculo}</td>
                    <td>${s.pax.linha_consolidada}</td>
                    <td>${motivoLabel[s.motivo] || s.motivo}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div style="width:50px; height:6px; background:var(--bg-input);
                                        border-radius:3px; overflow:hidden;">
                                <div style="width:${s.confianca}%; height:100%;
                                            background:${corBarra};"></div>
                            </div>
                            <span style="font-size:0.78rem; color:var(--text-muted);">
                                ${s.confianca}%
                            </span>
                        </div>
                    </td>
                    <td style="font-size:0.8rem; color:var(--text-muted);">
                        ${this._formatarViagemSugestao(s.viagem)}
                    </td>
                    <td class="score-detail">${c.veiculo  ?? ""}</td>
                    <td class="score-detail">${c.linha    ?? ""}</td>
                    <td class="score-detail">${c.sentido  ?? ""}</td>
                    <td class="score-detail">${c.gapCurto ?? ""}</td>
                    <td class="score-detail">${c.gapLongo ?? ""}</td>
                    <td class="score-detail">${c.scoreRaw ?? ""}</td>
                </tr>
            `;
        }).join("");
    },

    // ==========================================================
    // FILTROS DA TABELA DE SUGESTÕES
    // ==========================================================

    aplicarFiltrosSugestoes() {
        if (!AppState.session) return;

        const fEmp   = document.getElementById("sug-filter-empresa")?.value || "";
        const fVeic  = document.getElementById("sug-filter-veiculo")?.value.trim() || "";
        const fLinha = document.getElementById("sug-filter-linha")?.value.trim().toLowerCase() || "";
        const fConf  = document.getElementById("sug-filter-confianca")?.value || "";

        const filtradas = AppState.session.sugestoes.filter(s => {
            if (fEmp   && s.pax?.empresa !== fEmp)                        return false;
            if (fVeic  && !String(s.pax?.veiculo).includes(fVeic))        return false;
            if (fLinha && !s.pax?.linha_consolidada.toLowerCase().includes(fLinha))   return false;
            if (fConf === "alto"  && s.confianca < 70)                    return false;
            if (fConf === "medio" && (s.confianca < 45 || s.confianca >= 70)) return false;
            if (fConf === "baixo" && s.confianca >= 45)                   return false;
            return true;
        });

        this._renderSugestoesTabela(filtradas);
    },

    limparFiltrosSugestoes() {
        ["sug-filter-empresa", "sug-filter-veiculo", "sug-filter-linha", "sug-filter-confianca"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });

        if (AppState.session) {
            this._renderSugestoesTabela(AppState.session.sugestoes);
        }
    },

    _formatarViagemSugestao(v) {
        const hi = v.isOmissao ? v.partidaPlanejada : v.partidaReal;
        const hf = v.isOmissao ? v.chegadaPlanejada : v.chegadaReal;
        return `${v.linha_base} | ${v.veiculo || "—"} | ${hi ? hi.substring(0, 5) : "—"} | ${hf ? hf.substring(0, 5) : "—"}`;
    },


    // ==========================================================
    // SELETOR DE VIAGEM (atribuição manual)
    // ==========================================================

    atualizarSeletorViagens() {
        const select   = document.getElementById("select-target-trip");
        const fVeic    = document.getElementById("target-filter-veiculo")?.value.trim() || "";
        const fLinha   = document.getElementById("target-filter-linha")?.value.toLowerCase().trim() || "";
        const fStatus  = document.getElementById("target-filter-status")?.value || "";

        if (!AppState.session) return;
        if (!fVeic && !fLinha) {
            select.innerHTML = "<option value=''>Use os filtros ao lado para buscar...</option>";
            return;
        }

        const viagens = AppState.session.viagens
            .filter(v => {
                const matchV = !fVeic   || String(v.veiculo).includes(fVeic);
                const matchL = !fLinha  || v.linha.toLowerCase().includes(fLinha);
                const matchS = !fStatus
                    || (fStatus === "produtivo"  && !v.isOmissao && !v.isExtra)
                    || (fStatus === "omissao"    && v.isOmissao)
                    || (fStatus === "extra"      && v.isExtra)
                    || (fStatus === "editada"    && v.isEditada);
                return matchV && matchL && matchS;
            })
            .sort((a, b) => {
                if (a.linha_base !== b.linha_base) return a.linha_base.localeCompare(b.linha_base);
                if (a.veiculo    !== b.veiculo)    return String(a.veiculo).localeCompare(String(b.veiculo));
                const hA = a.isOmissao ? a.partidaPlanejada : a.partidaReal;
                const hB = b.isOmissao ? b.partidaPlanejada : b.partidaReal;
                return (hA || "").localeCompare(hB || "");
            });

        if (viagens.length === 0) {
            select.innerHTML = "<option value=''>Nenhuma viagem encontrada.</option>";
            return;
        }

        select.innerHTML = "<option value=''>Selecione a viagem destino...</option>"
            + viagens.map(v => {
                // Ícone de estado: abbr vem do mapa de status; [C] é estado derivado (omissão convertida)
                const statusDef = Object.values(APP_CONFIG.engine.status).find(s => s.value === v.statusOriginal);
                const abbr  = v.convertidaDeOmissao ? "C" : (statusDef?.abbr || "?");
                const icone = `[${abbr}]`;

                const hIni = v.isOmissao ? v.partidaPlanejada  : v.partidaReal;
                const hFim = v.isOmissao ? v.chegadaPlanejada  : v.chegadaReal;
                const veic = this._pad(v.veiculo || "------", 6);
                const lin  = this._pad(v.linha_base, 5);
                const sen  = this._pad(v.sentido,    5);
                const pax  = String(v.paxEfetivos.length).padStart(3, " ");

                const edit  = v.isEditada ? "[x]" : "[ ]";
                const tab   = String(v.tabela || "").padStart(2, " ");
                const label = `${icone} [${veic}] ${lin} | ${sen} | `
                    + `${(hIni || "").substring(0, 5)} às ${(hFim || "").substring(0, 5)} `
                    + `${edit} [${tab}] (${pax} pax)`;

                return `<option value="${v.id}">${label.replace(/ /g, "\u00A0")}</option>`;
            }).join("");

        // Alerta de omissão ao selecionar viagem do tipo [O]
        select.onchange = () => {
            const vid   = select.value;
            const alert = document.getElementById("omissao-alert");
            if (!vid || !alert) return;
            const v = AppState.session.viagens.find(t => t.id === vid);
            alert.style.display = v?.isOmissao ? "flex" : "none";
        };
    },


    // ==========================================================
    // FILTROS DA TABELA DE EXCEÇÕES
    // ==========================================================

    initFiltros() {
        // Inicialização: nada especial por enquanto
    },

    aplicarFiltros() {
        if (!AppState.session) return;

        const fEmp   = document.getElementById("filter-empresa")?.value || "";
        const fVeic  = document.getElementById("filter-veiculo")?.value.trim() || "";
        const fLinha = document.getElementById("filter-linha")?.value.trim().toLowerCase() || "";
        const fIni   = document.getElementById("filter-inicio")?.value || "";
        const fFim   = document.getElementById("filter-fim")?.value || "";

        const toMin = (hhmm) => {
            if (!hhmm) return null;
            const [h, m] = hhmm.split(":").map(Number);
            return h * 60 + m;
        };
        const mIni = toMin(fIni);
        const mFim = toMin(fFim);

        const conciliadas  = new Set(AppState.session.empresasConciliadas || []);
        const ignoradosIds = new Set((AppState.session.paxIgnorados || []).map(p => p.id));
        const orphaos = AppState.session.passageiros.filter(p =>
            !p.assigned &&
            !ignoradosIds.has(p.id) &&
            (conciliadas.size === 0 || conciliadas.has(p.empresa))
        );

        const filtrados = orphaos.filter(p => {
            if (fEmp   && p.empresa !== fEmp)                          return false;
            if (fVeic  && !String(p.veiculo).includes(fVeic))         return false;
            if (fLinha && !p.linha_consolidada.toLowerCase().includes(fLinha))     return false;
            if (mIni !== null && p.mHorario < mIni)                   return false;
            if (mFim !== null && p.mHorario > mFim)                   return false;
            return true;
        });

        this.renderExcecoes(filtrados);
        this.resetSelectAll();
        document.getElementById("count-selected").innerText =
            `${filtrados.length} encontrados`;
    },

    limparFiltros() {
        ["filter-empresa", "filter-veiculo", "filter-linha",
         "filter-inicio", "filter-fim"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });

        if (AppState.session) {
            const conciliadas  = new Set(AppState.session.empresasConciliadas || []);
            const ignoradosIds = new Set((AppState.session.paxIgnorados || []).map(p => p.id));
            this.renderExcecoes(AppState.session.passageiros.filter(p =>
                !p.assigned &&
                !ignoradosIds.has(p.id) &&
                (conciliadas.size === 0 || conciliadas.has(p.empresa))
            ));
        }

        this.resetSelectAll();
        this._atualizarContadorSelecionados();
    },


    // ==========================================================
    // SELECT ALL / CONTADOR
    // ==========================================================

    initSelectAll() {
        const cb = document.getElementById("select-all-pax");
        if (!cb) return;
        cb.addEventListener("change", () => {
            document.querySelectorAll(".pax-checkbox")
                .forEach(c => c.checked = cb.checked);
            this._atualizarContadorSelecionados();
        });
    },

    resetSelectAll() {
        const cb = document.getElementById("select-all-pax");
        if (cb) cb.checked = false;
        this._atualizarContadorSelecionados();
    },

    _atualizarContadorSelecionados() {
        const n = document.querySelectorAll(".pax-checkbox:checked").length;
        document.getElementById("count-selected").innerText = `${n} selecionados`;
    },


    // ==========================================================
    // MODAL GENÉRICO
    // ==========================================================

    showModal(titulo, htmlContent, opts = {}) {
        document.getElementById("modal-container")?.remove();
        document.body.classList.add("modal-open");

        const maxWidth = opts.maxWidth || "760px";

        document.body.insertAdjacentHTML("beforeend", `
            <div class="modal-overlay" id="modal-container">
                <div class="modal-content" style="max-width:${maxWidth};">
                    <div class="modal-header">
                        <h2 style="font-size:1.1rem; color:var(--primary); margin:0;">
                            ${titulo}
                        </h2>
                        <button class="btn-close-modal" id="btn-close-modal-top">✕</button>
                    </div>
                    <div class="modal-body">${htmlContent}</div>
                    <div class="modal-footer">
                        <button class="action-card btn btn-ghost"
                            id="btn-close-modal-bottom">
                            Fechar
                        </button>
                    </div>
                </div>
            </div>
        `);

        const fechar = () => {
            document.getElementById("modal-container")?.remove();
            document.body.classList.remove("modal-open");
        };

        document.getElementById("btn-close-modal-top").onclick    = fechar;
        document.getElementById("btn-close-modal-bottom").onclick  = fechar;
        document.getElementById("modal-container").onclick = (e) => {
            if (e.target.id === "modal-container") fechar();
        };
    },


    // ==========================================================
    // AUTO FILL AUDIT
    // Preenche filtros e seletor a partir do módulo Anomalies
    // ==========================================================

    autoFillAudit(veiculo, tripId) {
        document.getElementById("modal-container")?.remove();
        document.body.classList.remove("modal-open");

        // Preenche filtro de passageiros por veículo
        const fVeic = document.getElementById("filter-veiculo");
        if (fVeic) fVeic.value = veiculo;
        this.aplicarFiltros();

        // Preenche o seletor de viagens pela linha da viagem alvo
        const viagem = AppState.session?.viagens.find(v => v.id === tripId);
        if (viagem) {
            const fLinha = document.getElementById("target-filter-linha");
            if (fLinha) fLinha.value = viagem.linha_base;
        }

        document.getElementById("target-filter-veiculo").value = "";
        this.atualizarSeletorViagens();

        // Seleciona a viagem alvo no combo
        setTimeout(() => {
            const select = document.getElementById("select-target-trip");
            if (select && Array.from(select.options).some(o => o.value === tripId)) {
                select.value = tripId;
                select.dispatchEvent(new Event("change"));
            }
            document.getElementById("exception-section")?.scrollIntoView({ behavior: "smooth" });
        }, 150);
    },


    // ==========================================================
    // AUXILIARES INTERNOS
    // ==========================================================

    _popularFiltroEmpresas(session) {
        const select       = document.getElementById("filter-empresa");
        const conciliadas  = new Set(session.empresasConciliadas || []);
        const ignoradosIds = new Set((session.paxIgnorados || []).map(p => p.id));
        const empresas     = [...new Set(
            session.passageiros
                .filter(p =>
                    !p.assigned &&
                    !ignoradosIds.has(p.id) &&
                    (conciliadas.size === 0 || conciliadas.has(p.empresa))
                )
                .map(p => p.empresa).filter(Boolean)
        )].sort();
        select.innerHTML = "<option value=''>Empresa (Todas)</option>"
            + empresas.map(e => `<option value="${e}">${e}</option>`).join("");
    },

    // ==========================================================
    // EXPORTAÇÃO CSV
    // ==========================================================

    exportCSVSugestoes() {
        const lista = this._sugestoesVisiveis || [];
        const linhas = [
            ["Horário", "Empresa", "Veículo", "Linha", "Motivo", "Confiança",
             "Viagem sugerida", "Pts Veículo", "Pts Linha", "Pts Sentido", "Pts GapCurto", "Pts GapLongo", "Score Raw"]
        ];
        for (const s of lista) {
            const p = s.pax;
            const v = s.viagem;
            const hIni = v?.isOmissao ? v.partidaPlanejada : v?.partidaReal;
            const hFim = v?.isOmissao ? v.chegadaPlanejada : v?.chegadaReal;
            const viagem = v ? `${v.linha_base} | ${v.veiculo} | ${(hIni||"").substring(0,5)} às ${(hFim||"").substring(0,5)}` : "";
            const c = s.criterios || {};
            linhas.push([
                p?.horario, p?.empresa, p?.veiculo, p?.linha_consolidada,
                s.motivo, s.confianca + "%", viagem,
                c.veiculo ?? "", c.linha ?? "", c.sentido ?? "",
                c.gapCurto ?? "", c.gapLongo ?? "", c.scoreRaw ?? ""
            ]);
        }
        this._downloadCSV(linhas, "sugestoes");
    },

    exportCSVExcecoes() {
        const lista = this._excecoesVisiveis || [];
        const linhas = [
            ["Horário", "Empresa", "Veículo", "Linha", "Tipo"]
        ];
        for (const p of lista) {
            linhas.push([p.horario, p.empresa, p.veiculo, p.linha_consolidada, p.tipo]);
        }
        this._downloadCSV(linhas, "excecoes");
    },

    abrirResumoHorario() {
        const pax = AppState.session?.passageiros;
        if (!pax?.length) { alert("Nenhum dado carregado."); return; }

        const empresas = [...new Set(pax.map(p => p.empresa).filter(Boolean))].sort();
        const opts = empresas.map(e => `<option value="${e}">${e}</option>`).join("");

        this.showModal("Resumo horário — exportar", `
            <div style="display:flex; flex-direction:column; gap:16px;">

                <div>
                    <div style="font-size:11px; font-family:var(--mono); color:var(--text-3);
                                text-transform:uppercase; letter-spacing:.06em; margin-bottom:8px;">Formato</div>
                    <div style="display:flex; gap:24px;">
                        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:13px;">
                            <input type="radio" name="fmt-resumo" value="csv" checked> CSV
                        </label>
                        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:13px;">
                            <input type="radio" name="fmt-resumo" value="json"> JSON
                        </label>
                    </div>
                </div>

                <div>
                    <div style="font-size:11px; font-family:var(--mono); color:var(--text-3);
                                text-transform:uppercase; letter-spacing:.06em; margin-bottom:8px;">Empresa</div>
                    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <select id="sel-empresa-resumo" class="input" style="min-width:200px;">
                            <option value="">Todas as empresas</option>
                            ${opts}
                        </select>
                        <button class="btn btn-primary" id="btn-exportar-resumo" style="height:34px;">
                            Exportar
                        </button>
                    </div>
                </div>

                <p style="font-size:12px; color:var(--text-3); margin:0;">
                    <span id="desc-fmt-csv">Matriz de passageiros por linha × faixa horária (0–23 h). Inclui todos os passageiros independente do status de conciliação.</span>
                    <span id="desc-fmt-json" style="display:none;">JSON com viagens e passageiros por linha × faixa horária, incluindo metadados da operação.</span>
                </p>

            </div>
        `, { maxWidth: "500px" });

        document.querySelectorAll('input[name="fmt-resumo"]').forEach(r => {
            r.addEventListener("change", () => {
                const isJson = r.value === "json" && r.checked;
                document.getElementById("desc-fmt-csv").style.display  = isJson ? "none"   : "";
                document.getElementById("desc-fmt-json").style.display = isJson ? ""       : "none";
            });
        });

        document.getElementById("btn-exportar-resumo").onclick = () => {
            const empresa = document.getElementById("sel-empresa-resumo").value;
            const formato = document.querySelector('input[name="fmt-resumo"]:checked')?.value || "csv";
            if (formato === "json") this.exportJSONResumoHorario(empresa);
            else                    this.exportCSVResumoHorario(empresa);
        };
    },

    exportCSVResumoHorario(empresa) {
        const session = AppState.session;
        const todos = session?.passageiros || [];
        const lista = empresa ? todos.filter(p => p.empresa === empresa) : todos;
        const horas = Array.from({ length: 24 }, (_, i) => i);

        // Agrupa passageiros por sentido (null → "SEM_SENTIDO")
        const grupos = {};
        for (const p of lista) {
            const s = p.sentido || "SEM_SENTIDO";
            if (!grupos[s]) grupos[s] = [];
            grupos[s].push(p);
        }

        const gerarRows = paxList => {
            const mapa = {};
            for (const p of paxList) {
                const linha = p.linha_consolidada || "—";
                const hora  = parseInt((p.horario || "").split(" ")[1]?.split(":")[0] ?? "0", 10);
                if (isNaN(hora)) continue;
                const h = Math.min(Math.max(hora, 0), 23);
                if (!mapa[linha]) mapa[linha] = {};
                mapa[linha][h] = (mapa[linha][h] || 0) + 1;
            }
            const linhas  = Object.keys(mapa).sort();
            const rows    = [["Linha", ...horas, "Total"]];
            const totHora = horas.map(() => 0);
            for (const linha of linhas) {
                const counts = horas.map((h, i) => { const v = mapa[linha][h] || 0; totHora[i] += v; return v; });
                rows.push([linha, ...counts, counts.reduce((s, v) => s + v, 0)]);
            }
            rows.push(["TOTAL", ...totHora, totHora.reduce((s, v) => s + v, 0)]);
            return rows;
        };

        const sentidos = Object.keys(grupos).sort();

        const dataRef     = this._parseDataRefParaNome(session?.dataOperacao);
        const empresaCods = this._empresasAbbr(lista);
        const base        = `SUMM_${dataRef}_${empresaCods}`;

        if (sentidos.length === 1) {
            this._downloadCSV(gerarRows(grupos[sentidos[0]]), null, base);
        } else {
            this._downloadZIP(
                sentidos.map(s => ({ nome: null, nomeCompleto: `${base}_${s}`, linhas: gerarRows(grupos[s]) })),
                null, base
            );
        }
    },

    exportJSONResumoHorario(empresa) {
        const session  = AppState.session;
        const todoPax  = session?.passageiros || [];
        const todoVia  = session?.viagens     || [];
        const ignorIds = new Set((session?.paxIgnorados || []).map(p => p.id));

        const paxF = empresa ? todoPax.filter(p => p.empresa === empresa) : todoPax;
        const viaF = empresa ? todoVia.filter(v => v.empresa === empresa) : todoVia;

        // paxMapa[linha][sentido][hora] = count  (sentido null → "SEM_SENTIDO")
        const paxMapa = {};
        for (const p of paxF) {
            const linha   = p.linha_consolidada || "—";
            const sentido = p.sentido || "SEM_SENTIDO";
            const hora    = Math.min(Math.max(parseInt((p.horario || "").split(" ")[1]?.split(":")[0] ?? "0", 10), 0), 23);
            if (!paxMapa[linha])          paxMapa[linha] = {};
            if (!paxMapa[linha][sentido]) paxMapa[linha][sentido] = {};
            paxMapa[linha][sentido][hora] = (paxMapa[linha][sentido][hora] || 0) + 1;
        }

        // viaMapa[linha][sentido][hora] = count
        const viaMapa = {};
        for (const v of viaF) {
            const linha   = v.linha_base || "—";
            const sentido = v.sentido    || "UNICO";
            const hora    = Math.min(Math.max(Math.floor(v.mInicio / 60), 0), 23);
            if (!viaMapa[linha])          viaMapa[linha] = {};
            if (!viaMapa[linha][sentido]) viaMapa[linha][sentido] = {};
            viaMapa[linha][sentido][hora] = (viaMapa[linha][sentido][hora] || 0) + 1;
        }

        // Métricas da seleção
        const atribuidos      = paxF.filter(p => p.assigned).length;
        const ignorados       = paxF.filter(p => ignorIds.has(p.id)).length;
        const naoAtribuidos   = paxF.length - atribuidos - ignorados;
        const taxaConciliacao = (paxF.length - ignorados) > 0
            ? Math.round(atribuidos / (paxF.length - ignorados) * 100) : 0;

        // Monta entradas planas: uma por (linha, sentido)
        const todasLinhas = [...new Set([...Object.keys(paxMapa), ...Object.keys(viaMapa)])].sort();
        const linhasJSON  = [];

        for (const linha of todasLinhas) {
            const todosSentidos = [...new Set([
                ...Object.keys(paxMapa[linha] || {}),
                ...Object.keys(viaMapa[linha] || {}),
            ])].sort();

            for (const sentido of todosSentidos) {
                const faixas = [];
                for (let h = 0; h < 24; h++) {
                    const p = paxMapa[linha]?.[sentido]?.[h] || 0;
                    const v = viaMapa[linha]?.[sentido]?.[h] || 0;
                    if (p > 0 || v > 0) faixas.push({ hora: h, passageiros: p, viagens: v });
                }
                linhasJSON.push({
                    linha,
                    sentido,
                    total: {
                        passageiros: faixas.reduce((s, f) => s + f.passageiros, 0),
                        viagens:     faixas.reduce((s, f) => s + f.viagens,     0),
                    },
                    faixas,
                });
            }
        }

        const resultado = {
            consulta: {
                dataOperacao:     session.dataOperacao || "",
                empresa:          empresa || "Todas as empresas",
                geradoEm:         new Date().toISOString(),
                totalPassageiros: paxF.length,
                totalViagens:     viaF.length,
                atribuidos,
                naoAtribuidos,
                ignorados,
                taxaConciliacao:  `${taxaConciliacao}%`,
            },
            linhas: linhasJSON,
        };

        const dataRef     = this._parseDataRefParaNome(resultado.consulta.dataOperacao);
        const empresaCods = this._empresasAbbr(paxF);
        const nomeArq     = `SUMM_${dataRef}_${empresaCods}`;

        const json = JSON.stringify(resultado, null, 2);
        const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url; a.download = `${nomeArq}.json`; a.click();
        URL.revokeObjectURL(url);
    },

    // ==========================================================
    // OFERTA × DEMANDA
    // ==========================================================

    async abrirOfertaDemanda(fileList) {
        const lerArquivo = f => new Promise((res, rej) => {
            const r = new FileReader();
            r.onload  = e => { try { res(JSON.parse(e.target.result)); } catch { rej(new Error(`JSON inválido: ${f.name}`)); } };
            r.onerror = () => rej(new Error(`Erro ao ler: ${f.name}`));
            r.readAsText(f, "utf-8");
        });

        let dados;
        try {
            dados = await Promise.all(Array.from(fileList).map(lerArquivo));
        } catch (err) {
            alert(err.message);
            return;
        }

        const linhasSet = new Set();
        for (const d of dados)
            for (const l of (d.linhas || [])) linhasSet.add(l.linha);

        const linhas = [...linhasSet].sort();
        if (!linhas.length) { alert("Nenhuma linha encontrada nos arquivos."); return; }

        const optsLinhas = linhas.map(l => `<option value="${l}">${l}</option>`).join("");

        this.showModal("Oferta × Demanda", `
            <div style="display:flex; flex-direction:column; gap:16px;">

                <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                    <select id="sel-linha-od" class="input" style="min-width:160px;">
                        <option value="">Todas as linhas</option>
                        ${optsLinhas}
                    </select>
                    <button class="btn btn-primary" id="btn-gerar-od" style="height:34px;">
                        Gerar CSV
                    </button>
                </div>

                <p style="font-size:12px; color:var(--text-3); margin:0;">
                    ${dados.length} arquivo${dados.length > 1 ? "s" : ""} carregado${dados.length > 1 ? "s" : ""}
                    (${dados.length} dia${dados.length > 1 ? "s" : ""}).
                    Selecione uma linha para exportar por sentido, ou deixe em <em>Todas as linhas</em> para gerar 4 arquivos (demanda_ida, demanda_volta, oferta_ida, oferta_volta) em ZIP.
                </p>

            </div>
        `, { maxWidth: "520px" });

        document.getElementById("btn-gerar-od").onclick = () => {
            const linha = document.getElementById("sel-linha-od").value;
            this.gerarOfertaDemanda(dados, linha);
        };
    },

    gerarOfertaDemanda(dados, linha) {
        if (linha === "") {
            this._gerarOfertaDemandaTodas(dados);
            return;
        }

        const n     = dados.length;
        const horas = Array.from({ length: 24 }, (_, i) => i);
        const slug  = linha.replace(/[^a-zA-Z0-9]/g, "_");

        const sentidosSet = new Set();
        for (const d of dados)
            for (const e of (d.linhas || []))
                if (e.linha === linha) sentidosSet.add(e.sentido || "SEM_SENTIDO");

        const sentidos = [...sentidosSet].sort();

        const arquivos = sentidos.map(sentido => {
            const oferta  = new Array(24).fill(0);
            const demanda = new Array(24).fill(0);

            for (const d of dados) {
                const entry = (d.linhas || []).find(l => l.linha === linha && (l.sentido || "SEM_SENTIDO") === sentido);
                if (!entry) continue;
                for (const f of (entry.faixas || [])) {
                    if (f.hora >= 0 && f.hora < 24) {
                        oferta[f.hora]  += f.viagens     || 0;
                        demanda[f.hora] += f.passageiros || 0;
                    }
                }
            }

            return {
                nome:   `oferta_demanda_${slug}_${sentido}`,
                linhas: [
                    ["",        ...horas],
                    ["Oferta",  ...oferta.map(v  => Math.round(v  / n))],
                    ["Demanda", ...demanda.map(v => Math.round(v  / n))],
                ],
            };
        });

        if (arquivos.length === 1) {
            this._downloadCSV(arquivos[0].linhas, arquivos[0].nome);
        } else {
            this._downloadZIP(arquivos, `oferta_demanda_${slug}`);
        }
    },

    _gerarOfertaDemandaTodas(dados) {
        const n     = dados.length;
        const horas = Array.from({ length: 24 }, (_, i) => i);

        const linhasSet = new Set();
        for (const d of dados)
            for (const l of (d.linhas || [])) linhasSet.add(l.linha);
        const linhas = [...linhasSet].sort();

        const arquivos = [];

        for (const sentido of ["IDA", "VOLTA"]) {
            for (const metrica of ["demanda", "oferta"]) {
                const rows = [["Linha", ...horas]];

                for (const linha of linhas) {
                    const valores = new Array(24).fill(0);
                    let temDados  = false;

                    for (const d of dados) {
                        const entry = (d.linhas || []).find(l => l.linha === linha && (l.sentido || "SEM_SENTIDO") === sentido);
                        if (!entry) continue;
                        temDados = true;
                        for (const f of (entry.faixas || [])) {
                            if (f.hora >= 0 && f.hora < 24) {
                                valores[f.hora] += metrica === "oferta" ? (f.viagens || 0) : (f.passageiros || 0);
                            }
                        }
                    }

                    if (temDados) rows.push([linha, ...valores.map(v => Math.round(v / n))]);
                }

                arquivos.push({ nome: `${metrica}_${sentido.toLowerCase()}`, linhas: rows });
            }
        }

        this._downloadZIP(arquivos, "oferta_demanda_todas");
    },

    // Converte "DD/MM/AAAA[ HH:mm:ss]" → "AAAA_MM_DD"
    _parseDataRefParaNome(dataOperacao) {
        const parte = (dataOperacao || "").split(" ")[0];
        const [d, m, a] = parte.split("/");
        return (a && m && d) ? `${a}_${m.padStart(2, "0")}_${d.padStart(2, "0")}` : "s_data";
    },

    // Retorna os abbr distintos (APP_CONFIG.empresas) dos passageiros, ordenados e unidos por "_"
    _empresasAbbr(paxList) {
        const abbrMap = Object.fromEntries(
            Object.values(APP_CONFIG.empresas).map(e => [e.nome, e.abbr])
        );
        return [...new Set(paxList.map(p => p.empresa).filter(Boolean))]
            .sort()
            .map(nome => abbrMap[nome] || nome)
            .join("_") || "todas";
    },

    _downloadCSV(linhas, prefixo, nomeCompleto = null) {
        const escape = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const csv = linhas.map(row => row.map(escape).join(";")).join("\r\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        const data = new Date().toISOString().split("T")[0].replace(/-/g, "_");
        a.href = url; a.download = nomeCompleto ? `${nomeCompleto}.csv` : `${prefixo}_${data}.csv`; a.click();
        URL.revokeObjectURL(url);
    },

    // arquivos: [{ nome|nomeCompleto: "arquivo", linhas: [[...], ...] }, ...]
    async _downloadZIP(arquivos, nomeZip, nomeZipCompleto = null) {
        const escape = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const data   = new Date().toISOString().split("T")[0].replace(/-/g, "_");
        const zip    = new JSZip();

        for (const arq of arquivos) {
            const csv      = arq.linhas.map(row => row.map(escape).join(";")).join("\r\n");
            const nomeFile = arq.nomeCompleto ? `${arq.nomeCompleto}.csv` : `${arq.nome}_${data}.csv`;
            zip.file(nomeFile, "\uFEFF" + csv);
        }

        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url; a.download = nomeZipCompleto ? `${nomeZipCompleto}.zip` : `${nomeZip}_${data}.zip`; a.click();
        URL.revokeObjectURL(url);
    },


    // Pad de string para alinhamento monospaced no seletor de viagens
    _pad(str, length) {
        str = String(str || "");
        return str.length >= length
            ? str.substring(0, length)
            : str + "\u00A0".repeat(length - str.length);
    }
};
