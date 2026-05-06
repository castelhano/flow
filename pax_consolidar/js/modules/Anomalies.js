// ============================================================
// Anomalies.js — Análise pós-conciliação de anomalias
//
// Fluxo:
//   openModal()  → overlay full-screen com filtros de execução no topo
//   _processar() → tabs (Omissões | Suspeitas) + filtros por tab + cards
//
// Cada card de omissão tem:
//   • Collapse com passageiros alvo
//   • Painel lateral com viagens do carro + linha de sugestão inserida
// ============================================================

const Anomalies = {

    _pendentes: {},


    // ==========================================================
    // MODAL FULL-SCREEN
    // ==========================================================

    openModal() {
        const session = AppState.session;
        if (!session) return alert("Nenhum dado processado.");

        document.getElementById('anomalies-overlay')?.remove();
        document.body.classList.add('modal-open');

        const empresas = [...new Set(session.viagens.map(v => v.empresa).filter(Boolean))].sort();

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
                                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.84rem;">
                                        <input type="checkbox" id="anomalies-chk-omissoes" checked
                                            style="width:14px; height:14px; cursor:pointer; accent-color:var(--accent);">
                                        Omissões com passageiro
                                    </label>
                                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.84rem;">
                                        <input type="checkbox" id="anomalies-chk-editadas" checked
                                            style="width:14px; height:14px; cursor:pointer; accent-color:var(--accent);">
                                        Editadas suspeitas
                                    </label>
                                </div>
                            </div>

                            <button onclick="Anomalies._processar()"
                                class="btn btn-primary" style="height:36px; padding:0 24px;">
                                Processar
                            </button>

                        </div>
                    </div>

                    <!-- Resultados (preenchido pelo _processar) -->
                    <div id="anomalies-resultados"></div>

                </div>
            </div>
        `);
    },

    _fecharModal() {
        document.getElementById('anomalies-overlay')?.remove();
        document.body.classList.remove('modal-open');
    },


    // ==========================================================
    // PROCESSAMENTO
    // ==========================================================

    _processar() {
        const empresasSel = [
            ...document.querySelectorAll('input[name="anomalies-empresa"]:checked')
        ].map(el => el.value);

        const fazerOmissoes = document.getElementById('anomalies-chk-omissoes')?.checked;
        const fazerEditadas = document.getElementById('anomalies-chk-editadas')?.checked;

        if (empresasSel.length === 0) return alert("Selecione ao menos uma empresa.");
        if (!fazerOmissoes && !fazerEditadas) return alert("Selecione ao menos uma análise.");

        const session     = AppState.session;
        const empresasSet = new Set(empresasSel);

        const omissoesResult = fazerOmissoes ? this._analisarOmissoes(session, empresasSet) : null;
        const editadasResult = fazerEditadas ? this._analisarEditadas(session, empresasSet) : null;

        this._renderResultados(omissoesResult, editadasResult);
    },


    // ==========================================================
    // ANÁLISE 1 — Omissões com passageiro
    // ==========================================================

    _analisarOmissoes(session, empresasSet) {
        const cfg       = APP_CONFIG.anomalies.omissoesComPax;
        const pesos     = cfg.pesos;
        const janelaMax = cfg.janelaAuditoriaMax;

        const ignoradosIds = new Set((session.paxIgnorados || []).map(p => p.id));
        const orfaos = session.passageiros.filter(p =>
            !p.assigned && !ignoradosIds.has(p.id) && empresasSet.has(p.empresa) && p.veiculo
        );

        const orfaosPorChave = {};
        for (const p of orfaos) {
            const k = `${p.empresa}::${p.veiculo}`;
            (orfaosPorChave[k] = orfaosPorChave[k] || []).push(p);
        }

        const produtivas = session.viagens.filter(v => !v.isOmissao && empresasSet.has(v.empresa));
        const omissoes   = session.viagens.filter(v => v.isOmissao  && empresasSet.has(v.empresa));

        // Passo 1: enriquecer omissões com intervalo e veículo inferido
        const omissoesEnriquecidas = omissoes.map(omissao => {
            const mInicio = this._toMin(omissao.partidaPlanejada);
            const mFim    = this._toMin(omissao.chegadaPlanejada);

            const vizinhas = produtivas
                .filter(v => v.tabela === omissao.tabela && v.empresa === omissao.empresa)
                .sort((a, b) => a.mInicio - b.mInicio);
            const anterior      = vizinhas.filter(v => v.mFim   <= mInicio).pop();
            const proxima       = vizinhas.find(v  => v.mInicio >= mInicio);
            const veiculoInferido = anterior?.veiculo || proxima?.veiculo || null;

            return { omissao, mInicio, mFim, veiculoInferido, anterior, proxima };
        });

        // Passo 2: atribuir cada passageiro à omissão mais próxima do seu veículo
        const paxPorOmissao = {};

        for (const [chave, orfaosDoVeiculo] of Object.entries(orfaosPorChave)) {
            const omissoesDoVeiculo = omissoesEnriquecidas.filter(e =>
                e.veiculoInferido && `${e.omissao.empresa}::${e.veiculoInferido}` === chave
            );
            if (omissoesDoVeiculo.length === 0) continue;

            for (const p of orfaosDoVeiculo) {
                let melhor = null, melhorDelta = Infinity;
                for (const e of omissoesDoVeiculo) {
                    const { mInicio, mFim } = e;
                    if (p.mHorario < mInicio - janelaMax || p.mHorario > mFim + janelaMax) continue;
                    const delta = p.mHorario < mInicio ? mInicio - p.mHorario
                                : p.mHorario > mFim    ? p.mHorario - mFim
                                : 0;
                    if (delta < melhorDelta) { melhorDelta = delta; melhor = e; }
                }
                if (melhor) {
                    (paxPorOmissao[melhor.omissao.id] = paxPorOmissao[melhor.omissao.id] || []).push(p);
                }
            }
        }

        // Passo 3: pontuar
        const linhasIgnoradas = new Set(
            (APP_CONFIG.fontes.bilhetagem.linhasIgnoradas || []).map(l => String(l).trim())
        );
        const suspeitos = [];

        for (const { omissao, mInicio, mFim, veiculoInferido, anterior, proxima } of omissoesEnriquecidas) {
            if (!veiculoInferido) continue;

            const paxNaJanela = paxPorOmissao[omissao.id] || [];
            if (paxNaJanela.length < cfg.minPassageirosSuspeitos) continue;

            let score = 0;
            const criterios = [];

            const paxDaLinha = paxNaJanela.filter(p => p.linha_consolidada === omissao.linha_base);
            if (paxDaLinha.length > 0) {
                score += pesos.matchLinha;
                criterios.push({ label: `Linha ${omissao.linha_base} compatível (${paxDaLinha.length} pax)`, pts: pesos.matchLinha });
            }

            if (anterior && proxima) {
                score += pesos.gapEntreViagens;
                criterios.push({
                    label: `Entre viagens produtivas da tabela ${omissao.tabela} ` +
                           `(${anterior.partidaReal || anterior.partidaPlanejada} → ${proxima.partidaReal || proxima.partidaPlanejada})`,
                    pts: pesos.gapEntreViagens
                });
            }

            const chaveVeiculo    = `${omissao.empresa}::${veiculoInferido}`;
            const totalOrfaosVeic = (orfaosPorChave[chaveVeiculo] || []).length;
            if (totalOrfaosVeic > 0) {
                const perc = (paxNaJanela.length / totalOrfaosVeic) * 100;
                if (perc >= cfg.densidadePercentualMinimo) {
                    score += pesos.densidadeAlta;
                    criterios.push({
                        label: `${Math.round(perc)}% dos ${totalOrfaosVeic} órfãos do veículo ${veiculoInferido} estão nesta janela`,
                        pts: pesos.densidadeAlta
                    });
                }
            }

            const paxNaBorda = paxNaJanela.filter(p => p.mHorario < mInicio || p.mHorario > mFim);
            if (paxNaBorda.length > 0) {
                score += pesos.foraTolerancia;
                criterios.push({
                    label: `${paxNaBorda.length} passageiro(s) na zona de tolerância (fora do intervalo planejado)`,
                    pts: pesos.foraTolerancia
                });
            }

            const paxIgnoradosJanela = paxNaJanela.filter(p => linhasIgnoradas.has(p.linha_consolidada));
            if (paxIgnoradosJanela.length > 0) {
                const proporcao  = paxIgnoradosJanela.length / paxNaJanela.length;
                const penalidade = Math.round(pesos.penalidadeLinhaIgnorada * proporcao);
                score += penalidade;
                criterios.push({ label: `${paxIgnoradosJanela.length} pax de linha(s) ignorada(s) na janela`, pts: penalidade });
            }

            if (score < cfg.pontuacaoMinima) continue;

            let nivel = "baixo";
            if      (score >= cfg.thresholds.alto)  nivel = "alto";
            else if (score >= cfg.thresholds.medio) nivel = "medio";

            suspeitos.push({
                omissao, veiculoInferido, paxNaJanela,
                totalOrfaosVeiculo: totalOrfaosVeic,
                score, nivel, mInicio, mFim, criterios
            });
        }

        suspeitos.sort((a, b) => b.score - a.score);
        return suspeitos;
    },


    // ==========================================================
    // ANÁLISE 2 — Editadas suspeitas
    // ==========================================================

    _analisarEditadas(session, empresasSet) {
        const cfg   = APP_CONFIG.anomalies.editadasSuspeitas;
        const tol   = cfg.tolerancias;
        const pesos = cfg.pesos;

        const editadas = session.viagens.filter(v =>
            v.isEditada && empresasSet.has(v.empresa)
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
                const delta = Math.abs(mPartReal - mPartPlan);
                if (delta > tol.deltaInicioMin) {
                    score += pesos.deltaInicio;
                    criterios.push({ label: `Desvio de partida: ${delta} min (tolerância ${tol.deltaInicioMin} min)`, pts: pesos.deltaInicio });
                }
            }

            if (mChegPlan > 0 && mChegReal > 0) {
                const delta = Math.abs(mChegReal - mChegPlan);
                if (delta > tol.deltaFimMin) {
                    score += pesos.deltaFim;
                    criterios.push({ label: `Desvio de chegada: ${delta} min (tolerância ${tol.deltaFimMin} min)`, pts: pesos.deltaFim });
                }
            }

            if (mPartPlan > 0 && mChegPlan > 0 && mPartReal > 0 && mChegReal > 0) {
                const cicloPlan = mChegPlan - mPartPlan;
                const cicloReal = mChegReal - mPartReal;
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

    _renderResultados(omissoesResult, editadasResult) {
        this._pendentes = {};

        const hasBoth = omissoesResult !== null && editadasResult !== null;
        let html = "";

        if (hasBoth) {
            const nOm = omissoesResult.length;
            const nEd = editadasResult.length;
            html = `
                <div style="display:flex; gap:8px; margin-bottom:20px; flex-wrap:wrap;">
                    <button id="at-btn-omissoes" onclick="Anomalies._switchTab('omissoes')"
                        style="padding:8px 18px; font-size:0.82rem; cursor:pointer; border:none;
                               background:var(--accent); color:white; border-radius:4px; font-family:var(--mono);">
                        Omissões com passageiro&nbsp;<span style="opacity:0.75;">(${nOm})</span>
                    </button>
                    <button id="at-btn-editadas" onclick="Anomalies._switchTab('editadas')"
                        style="padding:8px 18px; font-size:0.82rem; cursor:pointer; border:none;
                               background:var(--bg-3); color:var(--text-2); border-radius:4px; font-family:var(--mono);">
                        Editadas suspeitas&nbsp;<span style="opacity:0.75;">(${nEd})</span>
                    </button>
                </div>
                <div id="at-tab-omissoes">${this._htmlTabContent('omissoes', omissoesResult)}</div>
                <div id="at-tab-editadas" style="display:none;">${this._htmlTabContent('editadas', editadasResult)}</div>
            `;
        } else if (omissoesResult !== null) {
            html = this._htmlTabContent('omissoes', omissoesResult);
        } else if (editadasResult !== null) {
            html = this._htmlTabContent('editadas', editadasResult);
        }

        const el = document.getElementById('anomalies-resultados');
        if (el) el.innerHTML = html;
    },

    _switchTab(id) {
        ['omissoes', 'editadas'].forEach(tab => {
            const panel = document.getElementById(`at-tab-${tab}`);
            const btn   = document.getElementById(`at-btn-${tab}`);
            if (panel) panel.style.display = tab === id ? 'block' : 'none';
            if (btn) {
                btn.style.background = tab === id ? 'var(--accent)' : 'var(--bg-3)';
                btn.style.color      = tab === id ? 'white'         : 'var(--text-2)';
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
            const empresas = [...new Set(items.map(s => s.omissao.empresa))].sort();
            const linhas   = [...new Set(items.map(s => s.omissao.linha_base))].sort();
            const carros   = [...new Set(items.map(s => s.veiculoInferido).filter(Boolean))].sort();

            const mkOpts = arr => arr.map(v => `<option value="${v}">${v}</option>`).join("");

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
                    <div>
                        <div ${labelStyle}>Carro</div>
                        <select id="af-om-carro" onchange="Anomalies._filtrarOmissoes()" ${selectStyle}>
                            <option value="">Todos</option>${mkOpts(carros)}
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
        const carro   = document.getElementById('af-om-carro')?.value   || "";
        document.querySelectorAll('[data-tipo="omissao"]').forEach(card => {
            const ok = (!empresa || card.dataset.empresa === empresa)
                    && (!linha   || card.dataset.linha   === linha)
                    && (!carro   || card.dataset.carro   === carro);
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
        const corNivel = { alto: "var(--danger)", medio: "var(--warning)", baixo: "var(--text-2)" };
        const cor      = corNivel[s.nivel];
        const label    = s.nivel.charAt(0).toUpperCase() + s.nivel.slice(1);
        const key      = `o_${idx}`;
        const nPax     = s.paxNaJanela.length;
        const labelColClosed = `Viagens do carro ▶`;
        const labelPaxClosed = `Ver ${nPax} passageiro${nPax !== 1 ? 's' : ''} ▼`;

        const badges = s.criterios.map(c => {
            const ptsCor   = c.pts < 0 ? "var(--danger)" : cor;
            const ptsLabel = c.pts >= 0 ? `+${c.pts}` : `${c.pts}`;
            return `
                <span style="display:inline-flex; align-items:center; justify-content:space-between; gap:5px;
                             background:var(--bg-4); border:1px solid var(--border); border-radius:4px;
                             padding:3px 8px; font-size:0.76rem; color:var(--text-2); white-space:nowrap;">
                    ${c.label}
                    <span style="font-weight:600; color:${ptsCor}; margin-left:6px;">${ptsLabel}</span>
                </span>
            `;
        }).join("");

        const paxRows = s.paxNaJanela.map(p => {
            const dentroIntervalo = p.mHorario >= s.mInicio && p.mHorario <= s.mFim;
            const style = !dentroIntervalo ? "color:var(--text-3); font-style:italic;" : "color:var(--text-2);";
            return `
                <tr>
                    <td style="padding:4px 10px; font-family:var(--mono); ${style}">${p.horario}</td>
                    <td style="padding:4px 10px; ${style}">${p.linha_consolidada}</td>
                    <td style="padding:4px 10px; ${style}">${p.tipo || "—"}</td>
                </tr>
            `;
        }).join("");

        return `
            <div id="anomalies-card-${key}"
                data-tipo="omissao"
                data-empresa="${s.omissao.empresa}"
                data-linha="${s.omissao.linha_base}"
                data-carro="${s.veiculoInferido}"
                style="border:1px solid var(--border); border-radius:6px; padding:14px;
                       margin-bottom:10px; display:flex; gap:0; align-items:flex-start;">

                <!-- Conteúdo principal -->
                <div style="flex:1; min-width:0;">

                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                        <div>
                            <span style="font-weight:600;">${s.omissao.linha}</span>
                            <span style="color:var(--text-3); font-size:0.82rem; margin-left:8px;">${s.omissao.empresa}</span>
                            <span style="font-family:var(--mono); font-size:0.82rem; color:var(--text-2); margin-left:12px;">
                                ${s.omissao.partidaPlanejada} → ${s.omissao.chegadaPlanejada}
                            </span>
                            <span style="font-size:0.82rem; color:var(--text-3); margin-left:12px;">
                                Veículo inferido: <strong style="color:var(--text-2);">${s.veiculoInferido}</strong>
                            </span>
                        </div>
                        <span style="color:${cor}; font-weight:700; font-size:0.82rem; white-space:nowrap; margin-left:12px;">
                            ${label}&nbsp;&nbsp;${s.score} pts
                        </span>
                    </div>

                    <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;">
                        ${badges}
                    </div>

                    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                        <button id="anomalies-col-btn-${key}"
                            data-label-closed="${labelPaxClosed}"
                            onclick="Anomalies._toggleCollapse('${key}')"
                            class="btn btn-ghost" style="font-size:0.78rem;">
                            ${labelPaxClosed}
                        </button>
                        <button id="anomalies-viagens-btn-${key}"
                            data-label-closed="${labelColClosed}"
                            onclick="Anomalies._toggleViagensCarro('${key}')"
                            class="btn btn-ghost" style="font-size:0.78rem;">
                            ${labelColClosed}
                        </button>
                        <button onclick="Anomalies._atribuirTodosOmissao('${key}')"
                            class="btn btn-primary" style="font-size:0.78rem;">
                            Atribuir Todos
                        </button>
                        <button onclick="Anomalies._ignorarCard('anomalies-card-${key}')"
                            class="btn btn-ghost" style="font-size:0.78rem;">
                            Ignorar
                        </button>
                    </div>

                    <!-- Collapse: passageiros -->
                    <div id="anomalies-col-${key}" style="display:none; margin-top:12px;
                         border-top:1px solid var(--border); padding-top:12px;">
                        <div style="max-height:220px; overflow-y:auto; border:1px solid var(--border); border-radius:4px;">
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
                        <p style="font-size:0.74rem; color:var(--text-3); margin:6px 0 0; font-style:italic;">
                            Em itálico: fora do intervalo planejado mas dentro da janela de tolerância.
                        </p>
                    </div>

                </div>

                <!-- Painel lateral: viagens do carro (lazy, oculto) -->
                <div id="anomalies-viagens-${key}"
                    style="display:none; width:400px; flex-shrink:0;
                           border-left:1px solid var(--border); padding-left:16px; margin-left:16px;">
                    <!-- preenchido em _toggleViagensCarro -->
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
    // PAINEL LATERAL — viagens do carro + sugestão inserida
    // ==========================================================

    _htmlViagensCarro(s) {
        const session = AppState.session;
        if (!session) return "";

        const viagens = session.viagens
            .filter(v => v.veiculo === s.veiculoInferido)
            .sort((a, b) => a.mInicio - b.mInicio);

        // Sugestão: a omissão inserida na ordem cronológica
        const sugestao = {
            _isSugestao:      true,
            linha_base:       s.omissao.linha_base,
            mInicio:          s.mInicio,
            mFim:             s.mFim,
            partidaReal:      s.omissao.partidaPlanejada,
            chegadaReal:      s.omissao.chegadaPlanejada,
            paxEfetivos:      s.paxNaJanela,
            isOmissao:        false,
            convertidaDeOmissao: false,
            isEditada:        false
        };

        const merged = [...viagens];
        const insertAt = merged.findIndex(v => v.mInicio > s.mInicio);
        if (insertAt === -1) merged.push(sugestao);
        else merged.splice(insertAt, 0, sugestao);

        const rows = merged.map(v => {
            if (v._isSugestao) {
                return `
                    <tr style="background:rgba(59,130,246,0.1);">
                        <td style="padding:4px 8px; border-left:3px solid var(--accent); color:var(--accent); font-weight:600;">
                            ${v.linha_base}
                            <span style="font-size:0.65rem; background:var(--accent); color:white;
                                         padding:1px 4px; border-radius:3px; margin-left:4px; vertical-align:middle;">
                                SUGESTÃO
                            </span>
                        </td>
                        <td style="padding:4px 8px; font-family:var(--mono); color:var(--accent);">${(v.partidaReal||"").substring(0,5)}</td>
                        <td style="padding:4px 8px; font-family:var(--mono); color:var(--accent);">${(v.chegadaReal||"").substring(0,5)}</td>
                        <td style="padding:4px 8px; color:var(--text-3);">—</td>
                        <td style="padding:4px 8px; color:var(--accent); font-weight:600;">${v.paxEfetivos.length}</td>
                    </tr>
                `;
            }

            const hIni      = v.isOmissao ? v.partidaPlanejada : v.partidaReal;
            const hFim      = v.isOmissao ? v.chegadaPlanejada : v.chegadaReal;
            const tipoBadge = v.isOmissao
                ? `<span style="color:var(--danger); font-size:0.7rem; margin-left:3px;">[O]</span>`
                : v.convertidaDeOmissao
                ? `<span style="color:var(--success); font-size:0.7rem; margin-left:3px;">[C]</span>`
                : "";
            const editadoCell = v.isEditada
                ? `<span style="color:var(--warning); font-weight:600;">Sim</span>`
                : `<span style="color:var(--text-3);">—</span>`;

            return `
                <tr style="${v.isEditada ? 'background:rgba(245,158,11,0.07);' : ''}">
                    <td style="padding:4px 8px;">${v.linha_base}${tipoBadge}</td>
                    <td style="padding:4px 8px; font-family:var(--mono);">${(hIni||"").substring(0,5)}</td>
                    <td style="padding:4px 8px; font-family:var(--mono);">${(hFim||"").substring(0,5)}</td>
                    <td style="padding:4px 8px;">${editadoCell}</td>
                    <td style="padding:4px 8px;">${v.paxEfetivos.length}</td>
                </tr>
            `;
        }).join("");

        return `
            <div style="font-size:0.82rem; color:var(--text-2); margin-bottom:8px;">
                Viagens do carro <strong style="color:var(--text);">${s.veiculoInferido}</strong>
                <span style="font-size:0.74rem; color:var(--text-3); margin-left:6px;">
                    (linha em azul = sugestão de inclusão)
                </span>
            </div>
            <div style="max-height:380px; overflow-y:auto; border:1px solid var(--border); border-radius:4px;">
                <table style="width:100%; font-size:0.78rem; border-collapse:collapse;">
                    <thead>
                        <tr style="text-align:left; background:var(--bg-3); position:sticky; top:0;">
                            <th style="padding:5px 8px; color:var(--text-3); font-size:0.7rem; border-bottom:1px solid var(--border);">Linha</th>
                            <th style="padding:5px 8px; color:var(--text-3); font-size:0.7rem; border-bottom:1px solid var(--border);">Início</th>
                            <th style="padding:5px 8px; color:var(--text-3); font-size:0.7rem; border-bottom:1px solid var(--border);">Fim</th>
                            <th style="padding:5px 8px; color:var(--text-3); font-size:0.7rem; border-bottom:1px solid var(--border);">Editado</th>
                            <th style="padding:5px 8px; color:var(--text-3); font-size:0.7rem; border-bottom:1px solid var(--border);">Pax</th>
                        </tr>
                    </thead>
                    <tbody style="color:var(--text-2);">${rows}</tbody>
                </table>
            </div>
        `;
    },


    // ==========================================================
    // AÇÕES DE UI
    // ==========================================================

    _toggleCollapse(key) {
        const el  = document.getElementById(`anomalies-col-${key}`);
        const btn = document.getElementById(`anomalies-col-btn-${key}`);
        if (!el) return;
        const open = el.style.display !== 'none';
        el.style.display = open ? 'none' : 'block';
        if (btn) btn.textContent = open ? btn.dataset.labelClosed : 'Recolher ▲';
    },

    _toggleViagensCarro(key) {
        const panel = document.getElementById(`anomalies-viagens-${key}`);
        const btn   = document.getElementById(`anomalies-viagens-btn-${key}`);
        if (!panel) return;

        const open = panel.style.display !== 'none';

        if (open) {
            panel.style.display = 'none';
            if (btn) btn.textContent = btn.dataset.labelClosed;
        } else {
            // Lazy render
            if (!panel.dataset.loaded) {
                const s = this._pendentes[key];
                if (s) panel.innerHTML = this._htmlViagensCarro(s);
                panel.dataset.loaded = '1';
            }
            panel.style.display = 'block';
            if (btn) btn.textContent = '◀ Fechar viagens';
        }
    },

    _atribuirTodosOmissao(key) {
        const s = this._pendentes[key];
        if (!s) return;
        const paxIds = s.paxNaJanela.map(p => p.id);
        Engine.atribuirManualmente(AppState.session, paxIds, s.omissao.id);
        UIController.updateDashboard(AppState.session);
        this._ignorarCard(`anomalies-card-${key}`);
        delete this._pendentes[key];
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

        const rows = [['Empresa', 'Linha', 'Início Plan', 'Fim Plan', 'Veículo Inferido',
                        'Nível', 'Score', 'Pax na Janela', 'Critérios']];

        for (const card of visibles) {
            const key = card.id.replace('anomalies-card-', '');
            const s   = this._pendentes[key];
            if (!s) continue;
            rows.push([
                s.omissao.empresa,
                s.omissao.linha,
                s.omissao.partidaPlanejada,
                s.omissao.chegadaPlanejada,
                s.veiculoInferido,
                s.nivel,
                s.score,
                s.paxNaJanela.length,
                s.criterios.map(c => `${c.label} (${c.pts >= 0 ? '+' : ''}${c.pts})`).join(' | ')
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
    }

};
