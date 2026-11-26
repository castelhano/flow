// ============================================================
// Anomalies.js — Análise pós-conciliação de anomalias
//
// Fluxo:
//   openModal()  → overlay full-screen com filtros de execução no topo
//   _processar() → tabs (Omissões | Suspeitas) + filtros por tab + cards
//
// Omissões: agrupa por linha+tabela em cadeias sequenciais, infere
//   veículo pela bilhetagem (% de órfãos do carro na janela do grupo)
// ============================================================

const Anomalies = {

    _pendentes: {},
    _cittatiItens: {},   // itens de cada aba Cittati (motivos/parciais/ponto), por índice da linha


    // ==========================================================
    // MODAL FULL-SCREEN
    // ==========================================================

    openModal() {
        const session = AppState.session;
        if (!session) return alert("Nenhum dado processado.");

        document.getElementById('anomalies-overlay')?.remove();
        document.body.classList.add('modal-open');

        const empresas = [...new Set(session.viagens.map(v => v.empresa).filter(Boolean))].sort();
        const ehCittati = session.viagens.some(v => v.cittati);

        const chkAnalise = (id, label, visivel = true) => `
            <label style="display:${visivel ? 'flex' : 'none'}; align-items:center; gap:8px; cursor:pointer; font-size:0.84rem;">
                <input type="checkbox" id="${id}" ${visivel ? 'checked' : ''}
                    style="width:14px; height:14px; cursor:pointer; accent-color:var(--accent);">
                ${label}
            </label>`;

        const checkboxesEmpresas = empresas.map(emp => `
            <label style="display:flex; align-items:center; gap:7px; padding:3px 0;
                          cursor:pointer; font-size:0.84rem; white-space:nowrap;">
                <input type="checkbox" name="anomalies-empresa" value="${emp}" checked
                    style="width:14px; height:14px; cursor:pointer; accent-color:var(--accent);">
                ${emp}
            </label>
        `).join("");

        document.body.insertAdjacentHTML('beforeend', `
            <div id="anomalies-overlay"
                style="position:fixed; inset:0; z-index:2000; background:var(--bg); overflow-y:auto;">

                <div style="max-width:1200px; margin:0 auto; padding:24px 32px 48px;">

                    <!-- Cabeçalho -->
                    <div style="display:flex; justify-content:space-between; align-items:center;
                                margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid var(--border);">
                        <h2 style="font-size:1.1rem; color:var(--primary); margin:0;">Análise de Anomalias</h2>
                        <button onclick="Anomalies._fecharModal()" class="btn btn-ghost">✕ Fechar</button>
                    </div>

                    <!-- Filtros de execução -->
                    <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:8px;
                                padding:20px 24px; margin-bottom:28px;">
                        <div style="display:flex; gap:32px; align-items:flex-end; flex-wrap:wrap;">

                            <div>
                                <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:0.08em;
                                            color:var(--text-3); font-weight:600; margin-bottom:10px;">Empresas</div>
                                <div style="display:flex; flex-wrap:wrap; gap:2px 18px;">
                                    ${checkboxesEmpresas}
                                </div>
                            </div>

                            <div style="flex:1; min-width:220px;">
                                <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:0.08em;
                                            color:var(--text-3); font-weight:600; margin-bottom:10px;">Análises</div>
                                <div style="display:flex; flex-direction:column; gap:8px;">
                                    ${chkAnalise('anomalies-chk-omissoes', 'Omissões com passageiro')}
                                    ${chkAnalise('anomalies-chk-editadas', 'Editadas suspeitas', !ehCittati)}
                                    ${chkAnalise('anomalies-chk-motivos',  'Validar motivos', ehCittati)}
                                    ${chkAnalise('anomalies-chk-parciais', 'Viagens parciais', ehCittati)}
                                    ${chkAnalise('anomalies-chk-ponto',    'Ponto final alterado', ehCittati)}
                                </div>
                            </div>

                            <button onclick="Anomalies._processar()"
                                class="btn btn-primary" style="height:36px; padding:0 24px;">
                                Processar
                            </button>

                        </div>
                    </div>

                    <!-- Consulta de viagens -->
                    <div style="background:var(--bg-2); border:1px solid var(--border); border-radius:8px;
                                padding:14px 20px; margin-bottom:28px;">
                        <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:0.08em;
                                    color:var(--text-3); font-weight:600; margin-bottom:12px;">Consulta de viagens</div>
                        <div style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
                            <div class="filter-group">
                                <label>Veículo</label>
                                <input type="text" id="anomalies-q-veiculo" placeholder="Ex: 1074"
                                    style="width:90px; height:30px; font-size:0.82rem;">
                            </div>
                            <div class="filter-group">
                                <label>Linha</label>
                                <input type="text" id="anomalies-q-linha" placeholder="Ex: A14"
                                    style="width:90px; height:30px; font-size:0.82rem;">
                            </div>
                            <div class="filter-group">
                                <label>Status</label>
                                <select id="anomalies-q-status" style="width:110px; height:30px; font-size:0.82rem;">
                                    <option value="">Todos</option>
                                    <option value="produtivo">Produtivo</option>
                                    <option value="omissao">Omissão</option>
                                    <option value="extra">Extra</option>
                                    <option value="editada">Editada</option>
                                </select>
                            </div>
                            <button onclick="Anomalies._buscarViagens()" class="btn btn-ghost"
                                style="height:32px; align-self:flex-end;">
                                <i data-lucide="search"></i>
                            </button>
                            <div class="filter-group" style="flex:1; min-width:240px;">
                                <label>Viagem</label>
                                <select id="anomalies-q-select"
                                    style="width:100%; height:30px; font-size:0.78rem; font-family:var(--mono);">
                                    <option value="">Use os filtros ao lado para buscar...</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Resultados (preenchido pelo _processar) -->
                    <div id="anomalies-resultados"></div>

                </div>
            </div>
        `);
        if (window.lucide) lucide.createIcons();
    },

    // Atalho dos contadores Cittati do resumo: abre o modal, processa com
    // as opções padrão e mostra a aba pedida
    abrirAba(aba) {
        this.openModal();
        if (!document.getElementById('anomalies-overlay')) return;
        this._processar();
        this._switchTab(aba);
    },

    _fecharModal() {
        document.getElementById('anomalies-overlay')?.remove();
        document.body.classList.remove('modal-open');
    },

    _buscarViagens() {
        const select  = document.getElementById('anomalies-q-select');
        const fVeic   = document.getElementById('anomalies-q-veiculo')?.value.trim() || "";
        const fLinha  = document.getElementById('anomalies-q-linha')?.value.toLowerCase().trim() || "";
        const fStatus = document.getElementById('anomalies-q-status')?.value || "";

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
                    || (fStatus === "produtivo" && !v.isOmissao && !v.isExtra)
                    || (fStatus === "omissao"   && v.isOmissao)
                    || (fStatus === "extra"     && v.isExtra)
                    || (fStatus === "editada"   && v.isEditada);
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

        const pad = (v, n) => String(v ?? "").padStart(n, " ");
        select.innerHTML = `<option value="">${viagens.length} viagem(ns) encontrada(s)</option>`
            + viagens.map(v => {
                const statusDef = Object.values(APP_CONFIG.engine.status).find(s => s.value === v.statusOriginal);
                const abbr  = v.convertidaDeOmissao ? "C" : (statusDef?.abbr || "?");
                const hIni  = v.isOmissao ? v.partidaPlanejada : v.partidaReal;
                const hFim  = v.isOmissao ? v.chegadaPlanejada : v.chegadaReal;
                const label = `[${abbr}] [${pad(v.veiculo || "------", 6)}] ${pad(v.linha_base, 5)} | `
                    + `${pad(v.sentido, 5)} | ${(hIni || "").substring(0, 5)} às ${(hFim || "").substring(0, 5)} `
                    + `[${String(v.tabela || "").padStart(2, " ")}] (${String(v.paxEfetivos.length).padStart(3, " ")} pax)`;
                return `<option value="${v.id}">${label}</option>`;
            }).join("");

        if (window.lucide) lucide.createIcons();
    },


    // ==========================================================
    // PROCESSAMENTO
    // ==========================================================

    _processar() {
        const empresasSel = [
            ...document.querySelectorAll('input[name="anomalies-empresa"]:checked')
        ].map(el => el.value);

        const marcado = id => !!document.getElementById(id)?.checked;
        const fazer = {
            omissoes: marcado('anomalies-chk-omissoes'),
            editadas: marcado('anomalies-chk-editadas'),
            motivos:  marcado('anomalies-chk-motivos'),
            parciais: marcado('anomalies-chk-parciais'),
            ponto:    marcado('anomalies-chk-ponto')
        };

        if (empresasSel.length === 0) return alert("Selecione ao menos uma empresa.");
        if (!Object.values(fazer).some(Boolean)) return alert("Selecione ao menos uma análise.");

        const session     = AppState.session;
        const empresasSet = new Set(empresasSel);

        this._pendentes = {};
        this._cittatiItens = {};
        const abas = [];

        if (fazer.omissoes) {
            const r = this._analisarOmissoes(session, empresasSet);
            abas.push({ id: 'omissoes', label: 'Omissões com passageiro', n: r.length, html: this._htmlTabContent('omissoes', r) });
        }
        if (fazer.editadas) {
            const r = this._analisarEditadas(session, empresasSet);
            abas.push({ id: 'editadas', label: 'Editadas suspeitas', n: r.length, html: this._htmlTabContent('editadas', r) });
        }
        if (fazer.motivos || fazer.parciais || fazer.ponto) {
            const c = CittatiAnalises.analisar(session, empresasSet);
            const avisoPax = c.semBilhetagem
                ? "Sem bilhetagem: passageiros não contam como indício. Justificativas de GPS inoperante (sem horário real) tendem a aparecer como sem indício."
                : "";
            if (fazer.motivos) abas.push({
                id: 'motivos', label: 'Motivos', n: c.motivos.length,
                html: this._htmlTabelaCittati('motivos', c.motivos, [
                    `Omissão precisa de motivo; realizada não deveria ter. Justificativa ${APP_CONFIG.fontes.cittati.motivosRealizada.map(m => m.slice(0, 3)).join("/")} sem indício de que a viagem rodou é suspeita.`,
                    `${c.justificadasOk} justificativa(s) com indício — o motor concorda, não listadas.`,
                    avisoPax
                ])
            });
            if (fazer.parciais) abas.push({
                id: 'parciais', label: 'Parciais', n: c.parciais.length,
                html: this._htmlTabelaCittati('parciais', c.parciais, [
                    "Não realizadas com um dos horários reais. Ida quebrada: o mesmo carro tem uma viagem com início e sem fim seguida de uma com fim e sem início — o GPS perdeu a passagem no ponto final. Já justificadas com motivo \"#\" ficam de fora.",
                    "Corrigir na Cittati; a correção aparece no BI no dia seguinte."
                ])
            });
            if (fazer.ponto) abas.push({
                id: 'ponto', label: 'Ponto final alterado', n: c.pontoFinal.length,
                html: this._htmlTabelaCittati('ponto', c.pontoFinal, [
                    `Viagens fechadas num ponto final que não é o da rota (linha + sentido + rota). Limite: até ${APP_CONFIG.fontes.cittati.pontoFinal.participacaoMaximaPct}% das viagens da rota.`
                ])
            });
        }

        this._renderResultados(abas);
    },


    // ==========================================================
    // ANÁLISE 1 — Omissões com passageiro
    // ==========================================================

    _analisarOmissoes(session, empresasSet) {
        const cfg     = APP_CONFIG.anomalies.omissoesComPax;
        const gapMax  = cfg.gapSequencialMax;
        const densMin = cfg.densidadePercentualMinimo;

        const ignoradosIds = new Set((session.paxIgnorados || []).map(p => p.id));
        const orfaos = session.passageiros.filter(p =>
            !p.assigned && !ignoradosIds.has(p.id) && empresasSet.has(p.empresa)
        );

        // Cittati: omissão com motivo "#" o operador já trata como realizada
        const omissoes = session.viagens.filter(v =>
            v.isOmissao && empresasSet.has(v.empresa) && !v.cittati?.motivoRealizada
        );

        // Agrupar por empresa + linha_base + tabela
        const mapaGrupos = {};
        for (const om of omissoes) {
            const key = `${om.empresa}||${om.linha_base}||${om.tabela}`;
            if (!mapaGrupos[key]) mapaGrupos[key] = [];
            mapaGrupos[key].push(om);
        }

        const suspeitos = [];

        for (const grupo of Object.values(mapaGrupos)) {
            grupo.sort((a, b) => a.mInicio - b.mInicio);

            // Dividir em cadeias sequenciais (gap entre fim e início de consecutivas < gapMax)
            const cadeias = [];
            let cadeia = [grupo[0]];
            for (let i = 1; i < grupo.length; i++) {
                const gap = grupo[i].mInicio - grupo[i - 1].mFim;
                if (gap < gapMax) {
                    cadeia.push(grupo[i]);
                } else {
                    cadeias.push(cadeia);
                    cadeia = [grupo[i]];
                }
            }
            cadeias.push(cadeia);

            for (const chain of cadeias) {
                const mInicioGrupo = chain[0].mInicio;
                const mFimGrupo    = chain[chain.length - 1].mFim;
                const linha_base   = chain[0].linha_base;
                const empresa      = chain[0].empresa;

                // Órfãos da mesma linha e empresa
                const orfaosLinha = orfaos.filter(p =>
                    p.empresa === empresa && p.linha_consolidada === linha_base
                );

                if (orfaosLinha.length === 0) continue;

                // Agrupar por veículo (veiculo vem da bilhetagem)
                const porVeiculo = {};
                for (const p of orfaosLinha) {
                    if (!p.veiculo) continue;
                    if (!porVeiculo[p.veiculo]) porVeiculo[p.veiculo] = [];
                    porVeiculo[p.veiculo].push(p);
                }

                const carrosSuspeitos = [];
                for (const [veiculo, paxCarro] of Object.entries(porVeiculo)) {
                    const paxNaJanela = paxCarro.filter(p =>
                        p.mHorario >= mInicioGrupo && p.mHorario <= mFimGrupo
                    );
                    if (paxNaJanela.length === 0) continue;
                    if (this._carroEmOutraViagem(session, veiculo, chain, paxNaJanela)) continue;
                    const percentual = Math.round((paxNaJanela.length / paxCarro.length) * 100);
                    if (percentual >= densMin) {
                        carrosSuspeitos.push({ veiculo, paxNaJanela, totalOrfaos: paxCarro, percentual });
                    }
                }

                if (carrosSuspeitos.length === 0) continue;

                carrosSuspeitos.sort((a, b) => b.percentual - a.percentual);

                suspeitos.push({
                    omissoes: chain,
                    linha_base,
                    empresa,
                    tabela: chain[0].tabela,
                    mInicioGrupo,
                    mFimGrupo,
                    carrosSuspeitos
                });
            }
        }

        return suspeitos;
    },


    // Cittati: toda viagem tem carro previsto, inclusive as omissões. Carro
    // escalado em outra viagem (fora desta cadeia) no horário dos passageiros
    // estava lá, não aqui — não é candidato. No Sonda a omissão não tem carro
    // e o critério fica como era.
    _carroEmOutraViagem(session, veiculo, chain, paxNaJanela) {
        if (!chain[0].cittati) return false;
        const ini = Math.min(...paxNaJanela.map(p => p.mHorario));
        const fim = Math.max(...paxNaJanela.map(p => p.mHorario));
        const daCadeia = new Set(chain.map(v => v.id));
        return session.viagens.some(v =>
            v.veiculo === veiculo && !daCadeia.has(v.id) && v.mInicio <= fim && v.mFim >= ini
        );
    },


    // ==========================================================
    // ANÁLISE 2 — Editadas suspeitas
    // ==========================================================

    _analisarEditadas(session, empresasSet) {
        const cfg   = APP_CONFIG.anomalies.editadasSuspeitas;
        const tol   = cfg.tolerancias;
        const pesos = cfg.pesos;

        const editadas = session.viagens.filter(v =>
            v.isEditada && !v.isOmissao && empresasSet.has(v.empresa)
        );

        const suspeitas = [];

        for (const v of editadas) {
            let score = 0;
            const criterios = [];

            if (v.paxEfetivos.length === 0) {
                score += pesos.semPassageiro;
                criterios.push({ label: "Sem passageiros após conciliação", pts: pesos.semPassageiro });
            }

            const mPartPlan = this._toMin(v.partidaPlanejada);
            const mChegPlan = this._toMin(v.chegadaPlanejada);
            const mPartReal = this._toMin(v.partidaReal);
            const mChegReal = this._toMin(v.chegadaReal);

            if (mPartPlan > 0 && mPartReal > 0) {
                const delta = this._deltaMin(mPartPlan, mPartReal);
                if (delta > tol.deltaInicioMin) {
                    score += pesos.deltaInicio;
                    criterios.push({ label: `Desvio de partida: ${delta} min (tolerância ${tol.deltaInicioMin} min)`, pts: pesos.deltaInicio });
                }
            }

            if (mChegPlan > 0 && mChegReal > 0) {
                const delta = this._deltaMin(mChegPlan, mChegReal);
                if (delta > tol.deltaFimMin) {
                    score += pesos.deltaFim;
                    criterios.push({ label: `Desvio de chegada: ${delta} min (tolerância ${tol.deltaFimMin} min)`, pts: pesos.deltaFim });
                }
            }

            if (mPartPlan > 0 && mChegPlan > 0 && mPartReal > 0 && mChegReal > 0) {
                const cicloPlan = (mChegPlan - mPartPlan + 1440) % 1440;
                const cicloReal = (mChegReal - mPartReal + 1440) % 1440;
                if (cicloPlan > 0 && cicloReal > 0) {
                    const delta = Math.abs(cicloReal - cicloPlan);
                    if (delta > tol.deltaCicloMin) {
                        score += pesos.deltaCiclo;
                        criterios.push({
                            label: `Desvio de ciclo: ${delta} min (plan ${cicloPlan} min → real ${cicloReal} min)`,
                            pts: pesos.deltaCiclo
                        });
                    }
                }
            }

            if (score < cfg.indiceMinimo) continue;

            let nivel = "baixo";
            if      (score >= cfg.thresholds.alto)  nivel = "alto";
            else if (score >= cfg.thresholds.medio) nivel = "medio";

            const hasSemPax = criterios.some(c => c.label.startsWith("Sem passageiro"));
            const hasDesvio = criterios.some(c => c.label.startsWith("Desvio"));
            const motivo = hasSemPax && hasDesvio ? "ambos"
                         : hasSemPax               ? "sem_passageiro"
                         :                           "desvio_horario";

            suspeitas.push({ viagem: v, score, nivel, criterios, motivo });
        }

        suspeitas.sort((a, b) => b.score - a.score);
        return suspeitas;
    },


    // ==========================================================
    // RENDER — preenche #anomalies-resultados
    // ==========================================================

    // abas: [{ id, label, n, html }]
    _renderResultados(abas) {
        const estiloBtn = ativo => `padding:8px 18px; font-size:0.82rem; cursor:pointer; border:none; border-radius:4px;
            font-family:var(--mono); background:${ativo ? 'var(--accent)' : 'var(--bg-3)'}; color:${ativo ? 'white' : 'var(--text-2)'};`;

        let html;
        if (abas.length === 1) {
            html = abas[0].html;
        } else {
            html = `
                <div style="display:flex; gap:8px; margin-bottom:20px; flex-wrap:wrap;">
                    ${abas.map((a, i) => `
                        <button id="at-btn-${a.id}" data-aba="${a.id}" onclick="Anomalies._switchTab('${a.id}')" style="${estiloBtn(i === 0)}">
                            ${a.label}&nbsp;<span style="opacity:0.75;">(${a.n})</span>
                        </button>`).join("")}
                </div>
                ${abas.map((a, i) => `<div id="at-tab-${a.id}" data-aba="${a.id}" style="display:${i === 0 ? 'block' : 'none'};">${a.html}</div>`).join("")}
            `;
        }

        const el = document.getElementById('anomalies-resultados');
        if (el) el.innerHTML = html;
    },

    _switchTab(id) {
        document.querySelectorAll('#anomalies-resultados [data-aba]').forEach(el => {
            const ativo = el.dataset.aba === id;
            if (el.tagName === 'BUTTON') {
                el.style.background = ativo ? 'var(--accent)' : 'var(--bg-3)';
                el.style.color      = ativo ? 'white'         : 'var(--text-2)';
            } else {
                el.style.display = ativo ? 'block' : 'none';
            }
        });
    },

    _htmlTabContent(tipo, items) {
        if (items.length === 0) {
            const msg = tipo === 'omissoes'
                ? "Nenhuma omissão suspeita identificada com os critérios atuais."
                : "Nenhuma viagem editada suspeita identificada com os critérios atuais.";
            return `<p style="color:var(--text-3); font-size:0.88rem; padding:8px 0;">${msg}</p>`;
        }

        let cards = "";
        if (tipo === 'omissoes') {
            items.forEach((s, i) => {
                this._pendentes[`o_${i}`] = s;
                cards += this._htmlCardOmissao(s, i);
            });
        } else {
            items.forEach((s, i) => {
                this._pendentes[`e_${i}`] = s;
                cards += this._htmlCardEditada(s, i);
            });
        }

        return `
            ${this._htmlFiltros(tipo, items)}
            <div id="${tipo}-cards">${cards}</div>
        `;
    },

    _htmlFiltros(tipo, items) {
        const selectStyle = `class="input" style="height:30px; font-size:0.82rem; min-width:130px;"`;
        const labelStyle  = `style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-3); margin-bottom:4px;"`;

        if (tipo === 'omissoes') {
            const empresas = [...new Set(items.map(s => s.empresa))].sort();
            const linhas   = [...new Set(items.map(s => s.linha_base))].sort();
            const mkOpts   = arr => arr.map(v => `<option value="${v}">${v}</option>`).join("");

            return `
                <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;
                            background:var(--bg-2); border:1px solid var(--border); border-radius:6px;
                            padding:10px 14px; margin-bottom:14px;">
                    <div>
                        <div ${labelStyle}>Empresa</div>
                        <select id="af-om-empresa" onchange="Anomalies._filtrarOmissoes()" ${selectStyle}>
                            <option value="">Todas</option>${mkOpts(empresas)}
                        </select>
                    </div>
                    <div>
                        <div ${labelStyle}>Linha</div>
                        <select id="af-om-linha" onchange="Anomalies._filtrarOmissoes()" ${selectStyle}>
                            <option value="">Todas</option>${mkOpts(linhas)}
                        </select>
                    </div>
                    <button onclick="Anomalies._exportCSVOmissoes()"
                        class="btn btn-ghost"
                        style="margin-left:auto; font-size:0.78rem; white-space:nowrap; height:30px; align-self:flex-end;">
                        ↓ CSV
                    </button>
                </div>
            `;
        } else {
            const empresas = [...new Set(items.map(s => s.viagem.empresa))].sort();
            const linhas   = [...new Set(items.map(s => s.viagem.linha_base || s.viagem.linha))].sort();
            const carros   = [...new Set(items.map(s => s.viagem.veiculo).filter(Boolean))].sort();
            const mkOpts   = arr => arr.map(v => `<option value="${v}">${v}</option>`).join("");

            const motivoLabels = { sem_passageiro: "Sem passageiro", desvio_horario: "Desvio de horário", ambos: "Ambos" };
            const motivosPresentes = [...new Set(items.map(s => s.motivo))].sort();
            const optsMotivo = motivosPresentes.map(m => `<option value="${m}">${motivoLabels[m] || m}</option>`).join("");

            return `
                <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;
                            background:var(--bg-2); border:1px solid var(--border); border-radius:6px;
                            padding:10px 14px; margin-bottom:14px;">
                    <div>
                        <div ${labelStyle}>Empresa</div>
                        <select id="af-ed-empresa" onchange="Anomalies._filtrarEditadas()" ${selectStyle}>
                            <option value="">Todas</option>${mkOpts(empresas)}
                        </select>
                    </div>
                    <div>
                        <div ${labelStyle}>Linha</div>
                        <select id="af-ed-linha" onchange="Anomalies._filtrarEditadas()" ${selectStyle}>
                            <option value="">Todas</option>${mkOpts(linhas)}
                        </select>
                    </div>
                    <div>
                        <div ${labelStyle}>Carro</div>
                        <select id="af-ed-carro" onchange="Anomalies._filtrarEditadas()" ${selectStyle}>
                            <option value="">Todos</option>${mkOpts(carros)}
                        </select>
                    </div>
                    <div>
                        <div ${labelStyle}>Motivo</div>
                        <select id="af-ed-motivo" onchange="Anomalies._filtrarEditadas()" ${selectStyle}>
                            <option value="">Todos</option>${optsMotivo}
                        </select>
                    </div>
                    <button onclick="Anomalies._exportCSVEditadas()"
                        class="btn btn-ghost"
                        style="margin-left:auto; font-size:0.78rem; white-space:nowrap; height:30px; align-self:flex-end;">
                        ↓ CSV
                    </button>
                </div>
            `;
        }
    },

    _filtrarOmissoes() {
        const empresa = document.getElementById('af-om-empresa')?.value || "";
        const linha   = document.getElementById('af-om-linha')?.value   || "";
        document.querySelectorAll('[data-tipo="omissao"]').forEach(card => {
            const ok = (!empresa || card.dataset.empresa === empresa)
                    && (!linha   || card.dataset.linha   === linha);
            card.style.display = ok ? '' : 'none';
        });
    },

    _filtrarEditadas() {
        const empresa = document.getElementById('af-ed-empresa')?.value || "";
        const linha   = document.getElementById('af-ed-linha')?.value   || "";
        const carro   = document.getElementById('af-ed-carro')?.value   || "";
        const motivo  = document.getElementById('af-ed-motivo')?.value  || "";
        document.querySelectorAll('[data-tipo="editada"]').forEach(card => {
            const ok = (!empresa || card.dataset.empresa === empresa)
                    && (!linha   || card.dataset.linha   === linha)
                    && (!carro   || card.dataset.carro   === carro)
                    && (!motivo  || card.dataset.motivo  === motivo);
            card.style.display = ok ? '' : 'none';
        });
    },


    // ==========================================================
    // CARD — omissão suspeita
    // ==========================================================

    _htmlCardOmissao(s, idx) {
        const key     = `o_${idx}`;
        const nOm     = s.omissoes.length;
        const hInicio = s.omissoes[0].partidaPlanejada.substring(0, 5);
        const hFim    = s.omissoes[nOm - 1].chegadaPlanejada.substring(0, 5);
        const omLabel = nOm > 1 ? `${nOm} omissões agrupadas` : `1 omissão`;

        const carrosHtml = s.carrosSuspeitos.map((carro, cIdx) => {
            const colKey   = `${key}-${cIdx}`;
            const nJanela  = carro.paxNaJanela.length;
            const nTotal   = carro.totalOrfaos.length;
            const pctColor = carro.percentual >= 90 ? "var(--danger)"
                           : carro.percentual >= 70 ? "var(--warning)"
                           :                          "var(--accent)";

            const paxRows = carro.paxNaJanela
                .slice()
                .sort((a, b) => a.mHorario - b.mHorario)
                .map(p => `
                    <tr>
                        <td style="padding:4px 10px; font-family:var(--mono); color:var(--text-2);">${p.horario}</td>
                        <td style="padding:4px 10px; color:var(--text-2);">${p.linha_consolidada}</td>
                        <td style="padding:4px 10px; color:var(--text-3);">${p.tipo || "—"}</td>
                    </tr>
                `).join("");

            return `
                <div id="ac-carro-${colKey}"
                    style="border:1px solid var(--border); border-radius:5px; padding:10px 14px;
                           margin-bottom:8px; background:var(--bg-2);">

                    <div style="display:flex; justify-content:space-between; align-items:center;
                                flex-wrap:wrap; gap:8px;">
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                            <span style="font-weight:700; font-size:0.9rem;">Carro ${carro.veiculo}</span>
                            <span style="font-weight:700; color:${pctColor}; font-size:0.88rem; font-family:var(--mono);">
                                ${carro.percentual}%
                            </span>
                            <span style="font-size:0.78rem; color:var(--text-3);">
                                ${nJanela} de ${nTotal} órfão${nTotal !== 1 ? 's' : ''} na janela
                            </span>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <button id="ac-col-btn-${colKey}"
                                data-label-closed="Ver passageiros ▼"
                                onclick="Anomalies._toggleCollapse('${colKey}')"
                                class="btn btn-ghost" style="font-size:0.76rem; padding:4px 10px;">
                                Ver passageiros ▼
                            </button>
                            <button onclick="Anomalies._atribuirCarro('${key}', ${cIdx})"
                                class="btn btn-primary" style="font-size:0.76rem; padding:4px 10px;">
                                Atribuir
                            </button>
                            <button onclick="Anomalies._ignorarCarro('ac-carro-${colKey}')"
                                class="btn btn-ghost" style="font-size:0.76rem; padding:4px 10px;">
                                Ignorar
                            </button>
                        </div>
                    </div>

                    <div id="ac-col-${colKey}" style="display:none; margin-top:10px;
                         border-top:1px solid var(--border); padding-top:10px;">
                        <div style="max-height:200px; overflow-y:auto; border:1px solid var(--border); border-radius:4px;">
                            <table style="width:100%; font-size:0.8rem; border-collapse:collapse;">
                                <thead>
                                    <tr style="background:var(--bg-3); text-align:left;">
                                        <th style="padding:5px 10px; color:var(--text-3); font-size:0.7rem; border-bottom:1px solid var(--border);">Horário</th>
                                        <th style="padding:5px 10px; color:var(--text-3); font-size:0.7rem; border-bottom:1px solid var(--border);">Linha</th>
                                        <th style="padding:5px 10px; color:var(--text-3); font-size:0.7rem; border-bottom:1px solid var(--border);">Tipo</th>
                                    </tr>
                                </thead>
                                <tbody>${paxRows}</tbody>
                            </table>
                        </div>
                    </div>

                </div>
            `;
        }).join("");

        return `
            <div id="anomalies-card-${key}"
                data-tipo="omissao"
                data-empresa="${s.empresa}"
                data-linha="${s.linha_base}"
                style="border:1px solid var(--border); border-radius:6px; padding:14px; margin-bottom:10px;">

                <div style="display:flex; justify-content:space-between; align-items:center;
                            margin-bottom:12px; flex-wrap:wrap; gap:6px;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span style="font-weight:600;">${s.omissoes[0].linha}</span>
                        <span style="color:var(--text-3); font-size:0.82rem;">${s.empresa}</span>
                        <span style="font-size:0.78rem; color:var(--text-3);">Tab. ${s.tabela}</span>
                        <span style="font-family:var(--mono); font-size:0.82rem; color:var(--text-2);">
                            ${hInicio} → ${hFim}
                        </span>
                    </div>
                    <span style="font-size:0.76rem; color:var(--text-3); white-space:nowrap;">
                        ${omLabel}${this._motivosOmissoes(s.omissoes)}
                    </span>
                </div>

                ${carrosHtml}

                <div style="margin-top:6px;">
                    <button onclick="Anomalies._ignorarCard('anomalies-card-${key}')"
                        class="btn btn-ghost" style="font-size:0.76rem;">
                        Ignorar tudo
                    </button>
                </div>

            </div>
        `;
    },


    // ==========================================================
    // CARD — editada suspeita
    // ==========================================================

    _htmlCardEditada(s, idx) {
        const corNivel = { alto: "var(--danger)", medio: "var(--warning)", baixo: "var(--text-2)" };
        const { viagem: v, score, nivel, criterios, motivo } = s;
        const cor   = corNivel[nivel];
        const label = nivel.charAt(0).toUpperCase() + nivel.slice(1);
        const key   = `e_${idx}`;

        const badges = criterios.map(c => `
            <span style="display:inline-flex; align-items:center; justify-content:space-between; gap:5px;
                         background:var(--bg-4); border:1px solid var(--border); border-radius:4px;
                         padding:3px 8px; font-size:0.76rem; color:var(--text-2); white-space:nowrap;">
                ${c.label}
                <span style="font-weight:600; color:${cor}; margin-left:6px;">+${c.pts}</span>
            </span>
        `).join("");

        return `
            <div id="anomalies-card-${key}"
                data-tipo="editada"
                data-empresa="${v.empresa}"
                data-linha="${v.linha_base || v.linha}"
                data-carro="${v.veiculo || ''}"
                data-motivo="${motivo}"
                style="border:1px solid var(--border); border-radius:6px; padding:14px; margin-bottom:10px;">

                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                    <div>
                        <span style="font-weight:600;">${v.linha}</span>
                        <span style="color:var(--text-3); font-size:0.82rem; margin-left:8px;">${v.empresa}</span>
                        <span style="font-family:var(--mono); font-size:0.82rem; color:var(--text-3); margin-left:12px;">${v.veiculo || "—"}</span>
                    </div>
                    <span style="color:${cor}; font-weight:700; font-size:0.82rem; white-space:nowrap; margin-left:12px;">
                        ${label}&nbsp;&nbsp;${score} pts
                    </span>
                </div>

                <div style="font-size:0.82rem; color:var(--text-2); margin-bottom:10px; font-family:var(--mono);">
                    Plan:&nbsp;${v.partidaPlanejada}&nbsp;→&nbsp;${v.chegadaPlanejada}
                    &nbsp;|&nbsp;
                    Real:&nbsp;${v.partidaReal}&nbsp;→&nbsp;${v.chegadaReal}
                    &nbsp;|&nbsp;
                    Pax: <strong>${v.paxEfetivos.length}</strong>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;">${badges}</div>

                <button onclick="Anomalies._ignorarCard('anomalies-card-${key}')"
                    class="btn btn-ghost" style="font-size:0.78rem;">
                    Ignorar
                </button>

            </div>
        `;
    },


    // ==========================================================
    // TABELA — análises Cittati (motivos, parciais, ponto final)
    // Uma linha por viagem; filtros por empresa, linha, carro e tipo.
    // ==========================================================

    _htmlTabelaCittati(aba, itens, notas = []) {
        this._cittatiItens[aba] = itens;

        const notasHtml = notas.filter(Boolean).map(n =>
            `<p style="font-size:0.78rem; color:var(--text-3); margin:0 0 6px; line-height:1.5;">${n}</p>`
        ).join("");

        if (itens.length === 0) {
            return `${notasHtml}<p style="color:var(--text-3); font-size:0.88rem; padding:8px 0;">Nenhuma viagem encontrada.</p>`;
        }

        const uniq   = f => [...new Set(itens.map(f).filter(Boolean))].sort();
        const opts   = arr => arr.map(v => `<option value="${this._esc(v)}">${this._esc(v)}</option>`).join("");
        const tipos  = uniq(x => x.tipo).map(t => `<option value="${t}">${CittatiAnalises.TIPOS[t] || t}</option>`).join("");
        const sel    = `class="input" style="height:30px; font-size:0.82rem; min-width:120px;" onchange="Anomalies._filtrarCittati('${aba}')"`;
        const lbl    = `style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-3); margin-bottom:4px;"`;
        const th     = `style="padding:6px 8px; color:var(--text-3); font-size:0.7rem; text-align:left; border-bottom:1px solid var(--border); white-space:nowrap;"`;

        const linhas = itens.map((x, i) => this._htmlLinhaCittati(aba, x, i)).join("");

        return `
            ${notasHtml}
            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; background:var(--bg-2);
                        border:1px solid var(--border); border-radius:6px; padding:10px 14px; margin:10px 0 14px;">
                <div><div ${lbl}>Empresa</div><select id="cf-${aba}-empresa" ${sel}><option value="">Todas</option>${opts(uniq(x => x.viagem.empresa))}</select></div>
                <div><div ${lbl}>Linha</div><select id="cf-${aba}-linha" ${sel}><option value="">Todas</option>${opts(uniq(x => x.viagem.linha_base))}</select></div>
                <div><div ${lbl}>Carro</div><select id="cf-${aba}-carro" ${sel}><option value="">Todos</option>${opts(uniq(x => x.viagem.veiculo))}</select></div>
                <div><div ${lbl}>Tipo</div><select id="cf-${aba}-tipo" ${sel}><option value="">Todos</option>${tipos}</select></div>
                <span id="cf-${aba}-contador" style="font-size:0.78rem; color:var(--text-3); align-self:center;">${itens.length} viagem(ns)</span>
                <button onclick="Anomalies._exportCSVCittati('${aba}')" class="btn btn-ghost"
                    style="margin-left:auto; font-size:0.78rem; white-space:nowrap; height:30px; align-self:flex-end;">↓ CSV</button>
            </div>
            <div style="overflow-x:auto; border:1px solid var(--border); border-radius:6px;">
                <table style="width:100%; font-size:0.8rem; border-collapse:collapse;">
                    <thead><tr style="background:var(--bg-3);">
                        <th ${th}>Tipo</th><th ${th}>Empresa</th><th ${th}>Linha</th><th ${th}>Rota</th><th ${th}>Tab</th>
                        <th ${th}>Carro</th><th ${th}>Previsto</th><th ${th}>Real</th><th ${th}>Motivo</th>
                        <th ${th} title="Realizada: passageiros atribuídos. Não realizada: passageiros do carro na janela da viagem.">Pax</th>
                        <th ${th}>Ponto final</th>
                    </tr></thead>
                    <tbody id="cf-${aba}-corpo">${linhas}</tbody>
                </table>
            </div>
        `;
    },

    _htmlLinhaCittati(aba, x, idx) {
        const v = x.viagem, c = v.cittati;
        const td  = (conteudo, extra = "") => `<td style="padding:5px 8px; border-bottom:1px solid var(--border); ${extra}">${conteudo}</td>`;
        const tag = (texto, cor) => `<span style="font-size:0.7rem; color:${cor}; border:1px solid ${cor}; border-radius:3px; padding:0 4px; margin-left:4px; white-space:nowrap;">${texto}</span>`;

        let tipo = CittatiAnalises.TIPOS[x.tipo] || x.tipo;
        if (x.parte) tipo += ` (${x.parte}/2)`;
        if (x.indicio) tipo += tag("com indício", "var(--warning)");

        const corTipo = { justificativa_suspeita: "var(--danger)", realizada_com_motivo: "var(--warning)", ida_quebrada: "var(--accent)" }[x.tipo] || "var(--text)";
        const pax = c.realizadaBI ? v.paxEfetivos.length : (x.paxJanela ?? "—");
        const ponto = c.pontoAlterado
            ? `${this._esc(c.pontoFinal)}<div style="font-size:0.7rem; color:var(--text-3);">rota: ${this._esc(c.pontoFinalRota)}</div>`
            : this._esc(c.pontoFinal);
        const real = c.realizadaBI || c.parcial
            ? `${v.partidaReal || "—"} → ${v.chegadaReal || "—"}`
            : "—";
        const motivo = (c.motivo ? this._esc(c.motivo) : `<span style="color:var(--text-3);">—</span>`)
            + (c.problemaHardware ? tag("falha hardware", "var(--text-3)") : "");
        const fundo = x.parte ? "background:var(--accent-glow);" : "";

        return `
            <tr data-idx="${idx}" data-empresa="${this._esc(v.empresa)}" data-linha="${this._esc(v.linha_base)}"
                data-carro="${this._esc(v.veiculo)}" data-tipo="${x.tipo}" style="${fundo}">
                ${td(tipo, `color:${corTipo}; white-space:nowrap;`)}
                ${td(this._esc(v.empresa))}
                ${td(this._esc(v.linha), "white-space:nowrap;")}
                ${td(this._esc(c.rota))}
                ${td(this._esc(v.tabela))}
                ${td(this._esc(v.veiculo) || "—", "font-family:var(--mono);")}
                ${td(`${v.partidaPlanejada} → ${v.chegadaPlanejada}`, "font-family:var(--mono); white-space:nowrap;")}
                ${td(real, "font-family:var(--mono); white-space:nowrap;")}
                ${td(motivo)}
                ${td(pax, "font-family:var(--mono); text-align:right;")}
                ${td(ponto)}
            </tr>
        `;
    },

    _filtrarCittati(aba) {
        const val = k => document.getElementById(`cf-${aba}-${k}`)?.value || "";
        const f = { empresa: val("empresa"), linha: val("linha"), carro: val("carro"), tipo: val("tipo") };
        let n = 0;
        document.querySelectorAll(`#cf-${aba}-corpo tr`).forEach(tr => {
            const ok = Object.entries(f).every(([k, v]) => !v || tr.dataset[k] === v);
            tr.style.display = ok ? "" : "none";
            if (ok) n++;
        });
        const cont = document.getElementById(`cf-${aba}-contador`);
        if (cont) cont.innerText = `${n} viagem(ns)`;
    },

    _exportCSVCittati(aba) {
        const itens = this._cittatiItens[aba] || [];
        const rows = [["Tipo", "Empresa", "Linha", "Sentido", "Rota", "Tabela", "Carro",
                       "Previsto início", "Previsto fim", "Real início", "Real fim",
                       "Motivo", "Falha hardware", "Pax", "Ponto final", "Ponto final da rota", "Id Cittati"]];
        document.querySelectorAll(`#cf-${aba}-corpo tr`).forEach(tr => {
            if (tr.style.display === "none") return;
            const x = itens[+tr.dataset.idx];
            if (!x) return;
            const v = x.viagem, c = v.cittati;
            rows.push([
                (CittatiAnalises.TIPOS[x.tipo] || x.tipo) + (x.parte ? ` (${x.parte}/2)` : "") + (x.indicio ? " - com indício" : ""),
                v.empresa, v.linha_base, v.sentido, c.rota, v.tabela, v.veiculo,
                c.prevInicio, c.prevFim, c.realInicio, c.realFim,
                c.motivo, c.problemaHardware ? "Sim" : "",
                c.realizadaBI ? v.paxEfetivos.length : (x.paxJanela ?? ""),
                c.pontoFinal, c.pontoFinalRota, c.id
            ]);
        });
        this._downloadCSV(rows, `cittati_${aba}`);
    },

    // Motivos das omissões de um card (Cittati), para o cabeçalho
    _motivosOmissoes(omissoes) {
        const motivos = [...new Set(omissoes.map(o => o.cittati?.motivo).filter(Boolean))];
        if (!omissoes.some(o => o.cittati)) return "";
        return motivos.length
            ? ` · motivo: ${motivos.map(m => this._esc(m)).join(", ")}`
            : ` · <span style="color:var(--danger);">sem motivo</span>`;
    },

    _esc(s) {
        return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    },


    // ==========================================================
    // AÇÕES DE UI
    // ==========================================================

    _toggleCollapse(key) {
        const el  = document.getElementById(`ac-col-${key}`);
        const btn = document.getElementById(`ac-col-btn-${key}`);
        if (!el) return;
        const open = el.style.display !== 'none';
        el.style.display = open ? 'none' : 'block';
        if (btn) btn.textContent = open ? btn.dataset.labelClosed : 'Recolher ▲';
    },

    _atribuirCarro(key, carroIdx) {
        const s = this._pendentes[key];
        if (!s) return;
        const carro = s.carrosSuspeitos[carroIdx];
        if (!carro) return;

        // Distribui pax para a omissão cujo intervalo os contém; restantes vão para a primeira
        const atribuidos = new Set();
        for (const om of s.omissoes) {
            const paxDaOm = carro.paxNaJanela.filter(p =>
                !atribuidos.has(p.id) && p.mHorario >= om.mInicio && p.mHorario <= om.mFim
            );
            if (paxDaOm.length > 0) {
                Engine.atribuirManualmente(AppState.session, paxDaOm.map(p => p.id), om.id);
                paxDaOm.forEach(p => atribuidos.add(p.id));
            }
        }
        const restantes = carro.paxNaJanela.filter(p => !atribuidos.has(p.id));
        if (restantes.length > 0) {
            Engine.atribuirManualmente(AppState.session, restantes.map(p => p.id), s.omissoes[0].id);
        }

        UIController.updateDashboard(AppState.session);
        document.getElementById(`ac-carro-${key}-${carroIdx}`)?.remove();
    },

    _ignorarCarro(carroId) {
        document.getElementById(carroId)?.remove();
    },

    _ignorarCard(cardId) {
        document.getElementById(cardId)?.remove();
    },


    // ==========================================================
    // EXPORTAÇÃO CSV
    // ==========================================================

    _exportCSVOmissoes() {
        const visibles = [...document.querySelectorAll('[data-tipo="omissao"]')]
            .filter(c => c.style.display !== 'none');

        const rows = [['Empresa', 'Linha', 'Tabela', 'Início Janela', 'Fim Janela',
                        'N Omissões', 'Carros Suspeitos', 'Percentuais', 'Pax na Janela']];

        for (const card of visibles) {
            const key = card.id.replace('anomalies-card-', '');
            const s   = this._pendentes[key];
            if (!s) continue;
            const nOm = s.omissoes.length;
            rows.push([
                s.empresa,
                s.linha_base,
                s.tabela,
                s.omissoes[0].partidaPlanejada,
                s.omissoes[nOm - 1].chegadaPlanejada,
                nOm,
                s.carrosSuspeitos.map(c => c.veiculo).join('; '),
                s.carrosSuspeitos.map(c => `${c.percentual}%`).join('; '),
                s.carrosSuspeitos.map(c => c.paxNaJanela.length).join('; ')
            ]);
        }

        this._downloadCSV(rows, 'anomalias_omissoes');
    },

    _exportCSVEditadas() {
        const visibles = [...document.querySelectorAll('[data-tipo="editada"]')]
            .filter(c => c.style.display !== 'none');

        const motivoLabels = { sem_passageiro: 'Sem passageiro', desvio_horario: 'Desvio de horário', ambos: 'Ambos' };
        const rows = [['Empresa', 'Linha', 'Veículo', 'Partida Plan', 'Chegada Plan',
                        'Partida Real', 'Chegada Real', 'Pax', 'Nível', 'Score', 'Motivo', 'Critérios']];

        for (const card of visibles) {
            const key = card.id.replace('anomalies-card-', '');
            const s   = this._pendentes[key];
            if (!s) continue;
            const v = s.viagem;
            rows.push([
                v.empresa,
                v.linha,
                v.veiculo || '',
                v.partidaPlanejada,
                v.chegadaPlanejada,
                v.partidaReal,
                v.chegadaReal,
                v.paxEfetivos.length,
                s.nivel,
                s.score,
                motivoLabels[s.motivo] || s.motivo,
                s.criterios.map(c => `${c.label} (+${c.pts})`).join(' | ')
            ]);
        }

        this._downloadCSV(rows, 'anomalias_editadas');
    },

    _downloadCSV(rows, filename) {
        const esc = v => {
            const s = String(v ?? '');
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? `"${s.replace(/"/g, '""')}"`
                : s;
        };
        const csv  = rows.map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), {
            href: url, download: `${filename}_${new Date().toISOString().slice(0, 10)}.csv`
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },


    // ==========================================================
    // AUXILIAR
    // ==========================================================

    _toMin(str) {
        if (!str) return 0;
        const match = String(str).match(/(\d{2}):(\d{2})/);
        if (!match) return 0;
        return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    },

    _deltaMin(a, b) {
        const diff = Math.abs(a - b);
        return Math.min(diff, 1440 - diff);
    }

};
