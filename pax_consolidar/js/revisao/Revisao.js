// ============================================================
// Revisao.js — Revisão do dia no GPS Cittati (página dos operadores)
//
// Versão simplificada do pax_consolidar. O operador escolhe a empresa e
// o dia e carrega a bilhetagem; a conciliação roda por trás (Engine), sem
// tela: ele só vê os casos para revisar, agrupados pelo que precisa fazer
// na Cittati. Marca cada um como corrigido ou "está certo" e salva as
// pendências. Num outro dia, confere o arquivo de pendências contra o BI
// atualizado. A conciliação completa (passageiros sem viagem, sugestões,
// atribuição) continua só no pax_consolidar.
//
// As regras são as mesmas do pax_consolidar: CittatiAnalises (motivos,
// parciais, ponto final), Anomalies._analisarOmissoes (omissão com
// passageiros) e Pendencias (arquivo e conferência). Aqui só muda a tela.
// Sem bilhetagem, passageiros não contam como indício e não há o grupo
// de omissão com passageiros.
//
// Uma viagem pode ter mais de um problema (ex.: sem motivo e pela
// metade). Na tela ela aparece uma vez, no primeiro grupo que a pega.
// ============================================================

const Revisao = {

    // Ordem = prioridade: a viagem fica no primeiro grupo que tiver um de seus tipos
    GRUPOS: [
        { id: "com_pax",    titulo: "Omissão com passageiros",       cor: "var(--danger)",
          tipos: ["omissao_com_pax"],
          acao: "A bilhetagem mostra passageiros de um carro desta linha no horário desta viagem não realizada. Confira se ela rodou: se rodou, corrija na Cittati." },
        { id: "metade",     titulo: "Viagem pela metade",            cor: "var(--warning)",
          tipos: ["inicio_sem_fim", "fim_sem_inicio", "ida_quebrada"],
          acao: "O GPS registrou só a saída ou só a chegada. Se a viagem foi feita, corrija o horário na Cittati; se não foi, lance o motivo." },
        { id: "sem_motivo", titulo: "Não realizada sem motivo",      cor: "var(--danger)",
          tipos: ["omissao_sem_motivo"],
          acao: "Toda viagem não realizada precisa de motivo. Lance o motivo; se a viagem foi feita, corrija a viagem." },
        { id: "com_motivo", titulo: "Realizada com motivo",          cor: "var(--warning)",
          tipos: ["realizada_com_motivo"],
          acao: "Viagem realizada não leva motivo. Retire o motivo na Cittati." },
        { id: "sem_sinal",  titulo: "Motivo # sem sinal de que rodou", cor: "var(--warning)",
          tipos: ["justificativa_suspeita"],
          acao: "O motivo diz que a viagem rodou, mas o GPS não registrou nada dela. Confira se rodou mesmo; se não rodou, troque o motivo." },
        { id: "ponto",      titulo: "Ponto final alterado",          cor: "var(--accent)",
          tipos: ["ponto_alterado"],
          acao: "A viagem foi encerrada num ponto diferente do final normal da rota. Confirme se foi isso mesmo." }
    ],

    // Regras: não dá para dispensar com "está certo". O operador pode
    // concluir que a viagem não rodou (omissão com passageiros, pela metade,
    // "#" sem sinal...), mas a omissão continua precisando de motivo e a
    // realizada continua não podendo ter. Só saem quando a Cittati estiver certa.
    REGRAS: new Set(["omissao_sem_motivo", "realizada_com_motivo"]),
    FALTA: {
        omissao_sem_motivo:   "falta lançar o motivo da omissão",
        realizada_com_motivo: "falta retirar o motivo"
    },

    SITUACOES: {
        pendente:       { label: "Continua igual",            cor: "var(--danger)" },
        alterada:       { label: "Mudou — confira",           cor: "var(--warning)" },
        nao_encontrada: { label: "Não encontrada no BI",      cor: "var(--text-3)" },
        resolvida:      { label: "Resolvida",                 cor: "var(--success)" }
    },

    // --- estado: revisão do dia ---
    empresa:  null,
    data:     null,
    meta:     null,      // { biAtualizadoEm, origem }
    casos:    [],        // { id, viagem, itens, grupo }
    marcas:   {},        // id da viagem → "corrigido" | "certo"
    grupoAtivo: null,

    // --- bilhetagem: arquivos escolhidos e o recorte já lido ---
    paxFiles:  [],
    _paxCache: null,     // { chave, pax, resumo }

    // --- estado: conferência ---
    conf: null,          // { arquivo, meta, viagens: [...], excluidos: Set, filtro }


    // ==========================================================
    // INÍCIO
    // ==========================================================

    iniciar() {
        // Empresas: as do cadastro de nomes da Cittati (BI → nome do Flow)
        const mapa = APP_CONFIG.fontes.cittati.normalizacao.empresa;
        const sel  = document.getElementById("rv-empresa");
        sel.innerHTML = `<option value="">escolha a empresa</option>` +
            Object.entries(mapa).map(([bi, nome]) => `<option value="${this._esc(nome)}">${this._esc(bi)}</option>`).join("");
        sel.value = localStorage.getItem("revisao.empresa") || "";
        sel.addEventListener("change", () => {
            localStorage.setItem("revisao.empresa", sel.value);
            this._lembrete();
        });

        const campo = document.getElementById("rv-dia");
        const ontem = this._ontemISO();
        campo.max = ontem;
        campo.value = ontem;
        campo.addEventListener("keydown", e => { if (e.key === "Enter") this.analisar(); });

        document.getElementById("rv-analisar").addEventListener("click", () => this.analisar());
        document.getElementById("rv-json").addEventListener("change", e => {
            const f = e.target.files[0]; e.target.value = "";
            if (f) this.analisarArquivo(f);
        });
        document.getElementById("rv-pax").addEventListener("change", async e => {
            const files = [...e.target.files]; e.target.value = "";
            for (const f of files) {
                try { await PaxCorte.validar(f); }
                catch (err) { return alert(`${f.name}: ${err.message}`); }
            }
            const chave = f => `${f.name}|${f.size}|${f.lastModified}`;
            const atuais = new Set(this.paxFiles.map(chave));
            this.paxFiles = [...this.paxFiles, ...files.filter(f => !atuais.has(chave(f)))];
            this._renderPax();
        });
        document.getElementById("rv-pax-limpar").addEventListener("click", () => {
            this.paxFiles = [];
            this._paxCache = null;
            this._renderPax();
        });
        document.getElementById("rv-pend").addEventListener("change", e => {
            const f = e.target.files[0]; e.target.value = "";
            if (f) this.conferir(f);
        });

        this._verificarServico();
        this._lembrete();
    },

    async _verificarServico() {
        const info = document.getElementById("rv-servico");
        try {
            const s = await Cittati.saude();
            this._biAtual = s.biAtualizadoEm || null;
            info.innerText = s.ok ? `BI atualizado em ${this._fmt(s.biAtualizadoEm)}` : "serviço no ar, mas o BI não respondeu";
            info.style.color = s.ok ? "" : "var(--warning)";
        } catch (err) {
            info.innerText = "serviço indisponível — dá para abrir o .json da Cittati";
            info.title = err.message;
            info.style.color = "var(--warning)";
        }
        this._lembrete();
    },

    _renderPax() {
        const nomes = this.paxFiles.map(f => f.name);
        const el = document.getElementById("rv-pax-nome");
        el.innerText = nomes.length === 0 ? "escolher arquivo(s)" : nomes.length === 1 ? nomes[0] : `${nomes.length} arquivos`;
        el.parentElement.title = nomes.join("\n");
        el.parentElement.classList.toggle("rv-carregado", nomes.length > 0);
        document.getElementById("rv-pax-limpar").classList.toggle("hidden", nomes.length === 0);
    },

    // Bilhetagem da empresa no dia operacional (recorte do PaxCorte, que
    // também pega a madrugada seguinte). Lida uma vez por dia + empresa +
    // arquivos; cada análise recebe cópias, porque o Engine marca os passageiros.
    async _paxDoDia(diaBR, empresa) {
        if (!this.paxFiles.length) return { pax: [], resumo: null };
        const chave = this.paxFiles.map(f => `${f.name}|${f.size}|${f.lastModified}`).join(",") + `|${diaBR}|${empresa}`;
        if (this._paxCache?.chave !== chave) {
            this._paxCache = null;
            const msg = `Lendo a bilhetagem de ${diaBR}...`;
            this._loader(msg);
            const { linhas, resumo } = await PaxCorte.carregar(this.paxFiles, diaBR,
                f => this._loader(`${msg} ${Math.round(f * 100)}%`));
            const norm = new DataNormalizer(APP_CONFIG.fontes.bilhetagem);
            const pax  = [];
            for (const r of linhas) {
                const p = norm.normalize(r);
                if (p.empresa === empresa) pax.push(p);
            }
            this._paxCache = { chave, pax, resumo };
        }
        return { pax: this._paxCache.pax.map(p => ({ ...p })), resumo: this._paxCache.resumo };
    },

    // Aviso de pendências salvas antes, guardado neste computador
    _lembrete() {
        const el  = document.getElementById("rv-lembrete");
        const emp = document.getElementById("rv-empresa").value;
        const u   = emp ? JSON.parse(localStorage.getItem(`revisao.ultimaPendencia.${emp}`) || "null") : null;
        if (!u) { el.classList.add("hidden"); return; }
        const atualizou = this._biAtual && Date.parse(this._biAtual) > Date.parse(u.salvoEm);
        el.innerHTML = `Você salvou pendências de <b>${Cittati.isoParaBR(u.data)}</b> em ${this._fmt(u.salvoEm)} ` +
            `(<span style="font-family:var(--mono);">${this._esc(u.nome)}</span>). ` +
            (atualizou
                ? `O BI já atualizou depois disso: confira em <b>Conferir pendências</b>.`
                : `Confira depois da próxima atualização do BI (de madrugada).`);
        el.classList.remove("hidden");
    },


    // ==========================================================
    // REVISAR O DIA
    // ==========================================================

    async analisar() {
        const empresa = document.getElementById("rv-empresa").value;
        const data    = document.getElementById("rv-dia").value;
        if (!empresa) return alert("Escolha a empresa.");
        if (!data)    return alert("Escolha o dia.");

        this._loader(`Buscando as viagens de ${Cittati.isoParaBR(data)}...`);
        try {
            const resposta = await Cittati.viagensDoDia(data);
            await this._montar(resposta, empresa, "serviço");
        } catch (err) {
            if (err.codigo === "dia_sem_dados") {
                alert(data >= this._ontemISO()
                    ? `Ainda não há dados da Cittati de ${Cittati.isoParaBR(data)}.\n\nO BI atualiza de madrugada: o dia de ontem costuma entrar por volta das 05:00.`
                    : `Não há viagens da Cittati em ${Cittati.isoParaBR(data)}.`);
            } else if (!err.codigo && /inacessível/.test(err.message)) {
                alert(`${err.message}\n\nSe o serviço estiver fora, abra o .json da Cittati pelo link "abrir arquivo".`);
            } else {
                alert(`Erro: ${err.message}`);
            }
        } finally {
            this._loader(null);
        }
    },

    async analisarArquivo(file) {
        const empresa = document.getElementById("rv-empresa").value;
        if (!empresa) return alert("Escolha a empresa.");
        this._loader("Lendo o arquivo da Cittati...");
        try {
            const resposta = JSON.parse(await file.text());
            await this._montar(resposta, empresa, file.name);
            document.getElementById("rv-dia").value = resposta.data;
        } catch (err) {
            alert(`Erro: ${err instanceof SyntaxError ? "o arquivo não é um JSON válido." : err.message}`);
        } finally {
            this._loader(null);
        }
    },

    async _montar(resposta, empresa, origem) {
        const linhas = Cittati.paraGps(resposta);     // valida; ponto final usa o dia inteiro
        const gps    = linhas.filter(l => l.empresa === empresa).map(l => ({ ...l }));
        if (gps.length === 0) throw new Error(`Nenhuma viagem de ${empresa} em ${Cittati.isoParaBR(resposta.data)}.`);

        // Conciliação por trás: o operador não vê, só o resultado das análises
        const { pax, resumo } = await this._paxDoDia(Cittati.isoParaBR(resposta.data), empresa);
        this._loader("Analisando...");
        await new Promise(r => setTimeout(r, 30));    // deixa o aviso aparecer antes do processamento
        const empresas = new Set([empresa]);
        const session  = new Engine(gps, pax).process([empresa]);
        const r        = CittatiAnalises.analisar(session, empresas);

        // Omissão com passageiros: a mesma análise do modal de Anomalias.
        // Cada omissão da sequência vira um caso; os carros vão junto.
        const comPax = [];
        if (session.temBilhetagem) {
            for (const s of Anomalies._analisarOmissoes(session, empresas)) {
                const carros = s.carrosSuspeitos.map(c => ({ veiculo: c.veiculo, pax: c.paxNaJanela.length, pct: c.percentual }));
                s.omissoes.forEach((v, i) => comPax.push({
                    tipo: "omissao_com_pax", viagem: v, carros,
                    parte: s.omissoes.length > 1 ? i + 1 : null, total: s.omissoes.length
                }));
            }
        }

        // id do caso = id da Cittati (não muda entre análises; as marcações dependem dele)
        const porViagem = new Map();
        for (const x of [...comPax, ...r.parciais, ...r.motivos, ...r.pontoFinal]) {
            const v = x.viagem, id = `c${v.cittati.id}`;
            if (!porViagem.has(id)) porViagem.set(id, { id, viagem: v, itens: [] });
            porViagem.get(id).itens.push(x);
        }
        const casos = [...porViagem.values()];
        for (const c of casos) {
            const tipos = new Set(c.itens.map(x => x.tipo));
            c.grupo = this.GRUPOS.find(g => g.tipos.some(t => tipos.has(t))).id;
        }
        casos.sort((a, b) => a.viagem.linha_base.localeCompare(b.viagem.linha_base, "pt-BR", { numeric: true })
            || a.viagem.mInicio - b.viagem.mInicio);

        this.empresa = empresa;
        this.data    = resposta.data;
        this.meta    = {
            biAtualizadoEm: resposta.biAtualizadoEm || null, origem, total: gps.length,
            comPax: session.temBilhetagem, nPax: pax.length,
            alertasPax: resumo?.alertas || []        // faltam dados do próprio dia (a virada não importa aqui)
        };
        this.casos   = casos;
        this.marcas  = JSON.parse(localStorage.getItem(this._chaveMarcas()) || "{}");
        this.grupoAtivo = (this.GRUPOS.find(g => casos.some(c => c.grupo === g.id)) || this.GRUPOS[0]).id;

        this._aba("revisar");
        this._renderRevisao();
    },

    _chaveMarcas() { return `revisao.marcas.${this.empresa}.${this.data}`; },

    _renderRevisao() {
        const el = document.getElementById("rv-resultado");
        const n  = this.casos.length;
        const revistos = this.casos.filter(c => this.marcas[c.id]).length;

        if (n === 0) {
            el.innerHTML = `<div class="rv-vazio">Nenhum caso para revisar em ${Cittati.isoParaBR(this.data)} (${this._esc(this.empresa)}).` +
                (this.meta.comPax ? "" : `<br>Sem bilhetagem: omissões com passageiros não foram analisadas.`) + `</div>`;
            return;
        }

        const cards = this.GRUPOS.map(g => {
            const doGrupo = this.casos.filter(c => c.grupo === g.id);
            const feitos  = doGrupo.filter(c => this.marcas[c.id]).length;
            const ativo   = g.id === this.grupoAtivo;
            return `
                <button class="rv-grupo ${ativo ? "ativo" : ""}" style="--cor:${g.cor}" ${doGrupo.length ? "" : "disabled"}
                    onclick="Revisao._grupo('${g.id}')">
                    <span class="rv-grupo-n">${doGrupo.length}</span>
                    <span class="rv-grupo-t">${g.titulo}</span>
                    <span class="rv-grupo-p">${doGrupo.length ? `${feitos} revisto(s)` : "nada"}</span>
                </button>`;
        }).join("");

        const g     = this.GRUPOS.find(x => x.id === this.grupoAtivo);
        const lista = this.casos.filter(c => c.grupo === g.id);

        el.innerHTML = `
            <div class="rv-barra">
                <div>
                    <b>${this._esc(this.empresa)}</b> · ${Cittati.isoParaBR(this.data)} · ${this.meta.total} viagens ·
                    BI de ${this._fmt(this.meta.biAtualizadoEm)}${this.meta.origem !== "serviço" ? ` (${this._esc(this.meta.origem)})` : ""} ·
                    ${this.meta.comPax
                        ? `${this.meta.nPax.toLocaleString("pt-BR")} passageiros`
                        : `<span style="color:var(--warning)">sem bilhetagem: omissões com passageiros não foram analisadas</span>`}
                </div>
                <div class="rv-progresso">
                    <div class="rv-progresso-fill" style="width:${Math.round(revistos / n * 100)}%"></div>
                </div>
                <span><b>${revistos}</b> de ${n} revistos</span>
                <button class="btn btn-primary" onclick="Revisao.salvarPendencias()">
                    <i data-lucide="save"></i> Salvar pendências
                </button>
            </div>

            ${this.meta.alertasPax.length ? `<div class="rv-aviso">⚠ Bilhetagem incompleta: ${this.meta.alertasPax.map(a => this._esc(a)).join(" ")}</div>` : ""}

            <div class="rv-grupos">${cards}</div>

            <div class="rv-acao" style="border-left-color:${g.cor}"><b>O que fazer:</b> ${g.acao}</div>

            <div class="table-wrap">
                <table class="rv-tabela">
                    <thead><tr>
                        <th>Linha</th><th>Tab</th><th>Carro</th><th>Previsto</th><th>O GPS registrou</th><th>Motivo</th><th></th>
                    </tr></thead>
                    <tbody>${lista.map(c => this._htmlCaso(c)).join("")}</tbody>
                </table>
            </div>`;
        if (window.lucide) lucide.createIcons();
    },

    _htmlCaso(c) {
        const v = c.viagem, ct = v.cittati;
        const marca = this.marcas[c.id];
        const h = s => Cittati._hora(s) || "—";
        const outros = c.itens
            .filter(x => !this.GRUPOS.find(g => g.id === c.grupo).tipos.includes(x.tipo))
            .filter(x => !(c.grupo === "metade" && x.tipo === "omissao_sem_motivo"))
            .map(x => this.GRUPOS.find(g => g.tipos.includes(x.tipo))?.titulo)
            .filter((t, i, a) => t && a.indexOf(t) === i);

        const botao = (tipo, texto) => `
            <button class="btn ${marca === tipo ? (tipo === "corrigido" ? "btn-success" : "btn-primary") : "btn-ghost"} rv-marca"
                onclick="Revisao._marcar('${c.id}', '${tipo}')">${texto}</button>`;

        // "Está certo" só para o que é julgamento; com ele, a regra que
        // sobrar continua valendo e a linha diz o que falta
        const podeDispensar = c.itens.some(x => !this.REGRAS.has(x.tipo));
        const falta = marca === "certo" ? this._falta(c) : [];
        const avisoFalta = falta.length
            ? `<div class="rv-tag" style="color:var(--warning)">não rodou, mas ${falta.join("; ")}</div>` : "";

        return `
            <tr class="${marca && !falta.length ? "rv-marcado" : ""}">
                <td><b>${this._esc(v.linha_base)}</b> ${this._esc(this._sentido(v.sentido, ct.rota))}
                    ${outros.length ? `<div class="rv-tag">também: ${outros.map(t => this._esc(t.toLowerCase())).join(", ")}</div>` : ""}</td>
                <td class="mono">${this._esc(v.tabela)}</td>
                <td class="mono">${this._esc(v.veiculo) || "—"}</td>
                <td class="mono">${h(ct.prevInicio)} → ${h(ct.prevFim)}</td>
                <td>${this._registro(ct, c.itens.find(x => x.tipo === "ida_quebrada"))}${this._carros(c)}</td>
                <td>${ct.motivo ? this._esc(ct.motivo) : `<span class="rv-fraco">sem motivo</span>`}${avisoFalta}</td>
                <td class="rv-botoes"><div class="rv-botoes-col">${botao("corrigido", "Corrigi")}${podeDispensar ? botao("certo", "Está certo") : ""}</div></td>
            </tr>`;
    },

    // "VOLTA" + rota "Volta 5A" → "Volta · Volta 5A" (rota só quando diz algo além do sentido)
    _sentido(sentido, rota) {
        sentido = String(sentido || "");
        const s = sentido.charAt(0) + sentido.slice(1).toLowerCase();
        return rota && rota.toLowerCase() !== sentido.toLowerCase() ? `${s} · ${rota}` : s;
    },

    // O que o GPS registrou, em uma frase. r: viagem.cittati ou um retrato
    // das pendências (mesmos campos). par: a outra metade de uma ida quebrada.
    _registro(r, q = null) {
        const h = s => Cittati._hora(s) || "?";
        let txt;
        if (r.realizadaBI)                       txt = `realizada ${h(r.realInicio)} → ${h(r.realFim)}`;
        else if (q && q.parte === 1)             txt = `saiu ${h(r.realInicio)}; a chegada ficou na viagem seguinte (${h(q.par.cittati.realFim)})`;
        else if (q)                              txt = `chegou ${h(r.realFim)}; a saída ficou na viagem anterior (${h(q.par.cittati.realInicio)})`;
        else if (r.parcial === "inicio_sem_fim") txt = `saiu ${h(r.realInicio)}, sem chegada`;
        else if (r.parcial === "fim_sem_inicio") txt = `chegou ${h(r.realFim)}, sem saída`;
        else                                     txt = `<span class="rv-fraco">nada</span>`;
        if (r.pontoAlterado) {
            txt += `<div class="rv-tag">terminou em ${this._esc(r.pontoFinal)} (normal: ${this._esc(r.pontoFinalRota)})</div>`;
        }
        return txt;
    },

    // Regras ainda não atendidas num caso (texto do que falta)
    _falta(c) {
        return [...new Set(c.itens.filter(x => this.REGRAS.has(x.tipo)).map(x => this.FALTA[x.tipo]))];
    },

    // Omissão com passageiros: carros que tiveram passageiros no horário
    _carros(c) {
        const x = c.itens.find(i => i.tipo === "omissao_com_pax");
        if (!x) return "";
        const seq = x.total > 1 ? ` · ${x.parte}ª de ${x.total} viagens seguidas` : "";
        return `<div class="rv-tag" style="color:var(--text-2)">passageiros no horário: ${x.carros
            .map(k => `carro ${this._esc(k.veiculo)} (${k.pax})`).join(", ")}${seq}</div>`;
    },

    _grupo(id) {
        this.grupoAtivo = id;
        this._renderRevisao();
    },

    _marcar(id, tipo) {
        if (this.marcas[id] === tipo) delete this.marcas[id];
        else this.marcas[id] = tipo;
        localStorage.setItem(this._chaveMarcas(), JSON.stringify(this.marcas));
        const y = window.scrollY;
        this._renderRevisao();
        window.scrollTo(0, y);
    },

    // Entra tudo, menos o que foi dispensado com "está certo" (que nunca
    // dispensa as regras: elas vão com marcação "certo"). "Corrigi" vai
    // junto para ser conferido depois da atualização do BI.
    async salvarPendencias() {
        const itens = [];
        let corrigidos = 0;
        for (const c of this.casos) {
            const marca = this.marcas[c.id];
            if (marca === "corrigido") corrigidos++;
            for (const x of c.itens) {
                if (marca === "certo" && !this.REGRAS.has(x.tipo)) continue;
                const it = Pendencias._item(x.tipo, c.viagem, {
                    parte: x.parte || null, parId: x.par ? x.par.cittati.id : null, marcacao: marca || null,
                    ...(x.carros ? { carros: x.carros, total: x.total } : {})
                });
                if (!Pendencias._resolvida(it.tipo, it.antes)) itens.push(it);
            }
        }
        if (itens.length === 0) return alert("Nada a salvar: todos os casos foram marcados como \"está certo\".");

        const naoVistos = this.casos.filter(c => !this.marcas[c.id]).length;
        if (naoVistos && !confirm(`${naoVistos} caso(s) ainda sem marcação. Eles vão para as pendências como não revistos.\n\nSalvar assim mesmo?`)) return;

        const arquivo = {
            tipo: Pendencias.TIPO_ARQUIVO, versao: Pendencias.VERSAO,
            data: this.data, geradoEm: new Date().toISOString(),
            biAtualizadoEm: this.meta.biAtualizadoEm, rodada: 1, comBilhetagem: this.meta.comPax,
            origem: "revisao", empresas: [this.empresa], itens
        };
        const nome = await Pendencias.salvar(arquivo);
        if (!nome) return;
        localStorage.setItem(`revisao.ultimaPendencia.${this.empresa}`,
            JSON.stringify({ data: this.data, salvoEm: arquivo.geradoEm, nome }));
        this._lembrete();
        alert(`Pendências salvas em ${nome}.\n\n${corrigidos} marcada(s) como corrigida(s). Depois da próxima atualização do BI ` +
              `(de madrugada), abra esse arquivo em "Conferir pendências" para ver o que já está certo na Cittati.`);
    },


    // ==========================================================
    // CONFERIR PENDÊNCIAS
    // ==========================================================

    async conferir(file) {
        let arquivo;
        try {
            arquivo = JSON.parse(await file.text());
            Pendencias.validar(arquivo);
        } catch (err) {
            return alert(`Erro: ${err instanceof SyntaxError ? "o arquivo não é um JSON válido." : err.message}`);
        }

        this._loader(`Buscando as viagens de ${Cittati.isoParaBR(arquivo.data)}...`);
        try {
            const resposta = await Cittati.viagensDoDia(arquivo.data);
            const linhas   = Cittati.paraGps(resposta);
            const meta     = { biAtualizadoEm: resposta.biAtualizadoEm || null, origem: "serviço" };
            const res      = Pendencias.avaliar(arquivo, linhas);

            // Agrupa os itens por viagem: a viagem fica com a pior situação
            const ordem = Object.keys(this.SITUACOES);
            const porViagem = new Map();
            res.forEach((r, i) => {
                const k = String(r.item.chave.id);
                if (!porViagem.has(k)) porViagem.set(k, { k, resultados: [], indices: [] });
                const g = porViagem.get(k);
                g.resultados.push(r); g.indices.push(i);
            });
            const viagens = [...porViagem.values()].map(g => {
                g.situacao = g.resultados.map(r => r.situacao).sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))[0];
                g.r = g.resultados[0];
                return g;
            }).sort((a, b) => a.r.item.chave.linha_base.localeCompare(b.r.item.chave.linha_base, "pt-BR", { numeric: true })
                || (a.r.item.antes.mPrevInicio ?? 0) - (b.r.item.antes.mPrevInicio ?? 0));

            this.conf = { arquivo, meta, res, viagens, excluidos: new Set(), filtro: "abertas", nome: file.name };
            this._aba("conferir");
            this._renderConferencia();
        } catch (err) {
            alert(err.codigo === "dia_sem_dados" ? `O BI não tem viagens em ${Cittati.isoParaBR(arquivo.data)}.` : `Erro: ${err.message}`);
        } finally {
            this._loader(null);
        }
    },

    _renderConferencia() {
        const { arquivo, meta, viagens, filtro } = this.conf;
        const el    = document.getElementById("rv-conferencia");
        const aviso = Pendencias._avisoAtualizacao(arquivo, meta);
        const cont  = Object.fromEntries(Object.keys(this.SITUACOES).map(k => [k, viagens.filter(v => v.situacao === k).length]));
        const empresa = (arquivo.empresas || []).join(", ");

        const visiveis = viagens.filter(v => filtro === "todas" || (filtro === "abertas" ? v.situacao !== "resolvida" : v.situacao === filtro));

        const chip = (id, texto, n, cor) => `
            <button class="rv-chip ${filtro === id ? "ativo" : ""}" style="--cor:${cor}" onclick="Revisao._filtroConf('${id}')">
                <b>${n}</b> ${texto}
            </button>`;

        el.innerHTML = `
            <div class="rv-barra">
                <div>
                    Pendências de <b>${this._esc(empresa)}</b> · ${Cittati.isoParaBR(arquivo.data)} ·
                    salvas em ${this._fmt(arquivo.geradoEm)} · BI de ${this._fmt(meta.biAtualizadoEm)}
                </div>
                <button class="btn btn-primary" onclick="Revisao.salvarRestantes()">
                    <i data-lucide="save"></i> Salvar o que falta
                </button>
            </div>

            ${aviso ? `<div class="rv-aviso">⚠ ${this._esc(aviso)}</div>` : ""}

            <div class="rv-chips">
                ${chip("abertas", "a resolver", viagens.length - cont.resolvida, "var(--text-2)")}
                ${Object.entries(this.SITUACOES).map(([k, s]) => chip(k, s.label.toLowerCase(), cont[k], s.cor)).join("")}
                ${chip("todas", "todas", viagens.length, "var(--text-3)")}
            </div>

            ${visiveis.length === 0 ? `<div class="rv-vazio">Nada aqui.</div>` : `
            <div class="table-wrap">
                <table class="rv-tabela">
                    <thead><tr>
                        <th>Situação</th><th>Caso</th><th>Linha</th><th>Tab</th><th>Carro</th><th>Previsto</th><th>Agora no GPS</th><th></th>
                    </tr></thead>
                    <tbody>${visiveis.map(v => this._htmlConf(v)).join("")}</tbody>
                </table>
            </div>`}`;
        if (window.lucide) lucide.createIcons();
    },

    _htmlConf(g) {
        const r = g.r, it = r.item, a = r.agora, ret = a || it.antes;
        const sit = this.SITUACOES[g.situacao];
        const h = s => Cittati._hora(s) || "—";
        const disp = this._dispensaveis(g);
        const fora = disp.length > 0 && disp.every(i => this.conf.excluidos.has(i));
        const tipos = [...new Set(g.resultados.map(x => this.GRUPOS.find(gr => gr.tipos.includes(x.item.tipo))?.titulo).filter(Boolean))];
        const regraAberta = g.resultados.filter(x => this.REGRAS.has(x.item.tipo) && x.situacao !== "resolvida");
        const certoMasFalta = regraAberta.length && (it.marcacao === "certo" || fora)
            ? `<div class="rv-tag" style="color:var(--warning)">não rodou, mas ${[...new Set(regraAberta.map(x => this.FALTA[x.item.tipo]))].join("; ")}</div>` : "";
        const mud = [...new Set(g.resultados.flatMap(x => [...x.mudancas, ...x.novos.map(t => `agora: ${CittatiAnalises.TIPOS[t] || t}`)]))];
        const marcou = it.marcacao === "corrigido" && g.situacao === "pendente"
            ? `<div class="rv-tag" style="color:var(--warning)">marcada como corrigida, mas ainda não aparece no BI</div>` : "";

        const agora = a
            ? `${this._registro(a)}<div class="rv-tag">${a.motivo ? this._esc(a.motivo) : "sem motivo"}</div>`
            : "—";

        return `
            <tr class="${fora && !regraAberta.length ? "rv-marcado" : ""}">
                <td style="color:${sit.cor}; white-space:nowrap;">${sit.label}${marcou}${certoMasFalta}</td>
                <td>${tipos.map(t => this._esc(t)).join("<br>")}${mud.length ? `<div class="rv-tag">${mud.map(m => this._esc(m)).join("<br>")}</div>` : ""}</td>
                <td><b>${this._esc(it.chave.linha_base)}</b> ${this._esc(this._sentido(it.chave.sentido, ret.rota))}</td>
                <td class="mono">${this._esc(it.chave.tabela)}</td>
                <td class="mono">${this._esc(ret.veiculo) || "—"}</td>
                <td class="mono">${h(it.antes.prevInicio)} → ${h(it.antes.prevFim)}</td>
                <td>${agora}</td>
                <td class="rv-botoes">${!disp.length ? "" : `
                    <button class="btn ${fora ? "btn-primary" : "btn-ghost"} rv-marca" onclick="Revisao._excluirConf('${g.k}')"
                        title="Conferido, não precisa corrigir: não vai para o arquivo do que falta">Está certo</button>`}</td>
            </tr>`;
    },

    _filtroConf(f) {
        this.conf.filtro = f;
        this._renderConferencia();
    },

    // Itens da viagem que o "está certo" pode tirar do arquivo do que falta:
    // os de julgamento ainda abertos (regras nunca)
    _dispensaveis(g) {
        return g.indices.filter((i, n) =>
            !this.REGRAS.has(g.resultados[n].item.tipo) && g.resultados[n].situacao !== "resolvida");
    },

    _excluirConf(k) {
        const g = this.conf.viagens.find(v => v.k === k);
        const disp = this._dispensaveis(g);
        const fora = disp.every(i => this.conf.excluidos.has(i));
        disp.forEach(i => fora ? this.conf.excluidos.delete(i) : this.conf.excluidos.add(i));
        const y = window.scrollY;
        this._renderConferencia();
        window.scrollTo(0, y);
    },

    async salvarRestantes() {
        const { arquivo, res, excluidos, meta } = this.conf;
        const novo = Pendencias.restantes(arquivo, res, excluidos, meta);
        if (novo.itens.length === 0) return alert("Nada falta: tudo resolvido ou marcado como certo. Não precisa salvar.");
        const nome = await Pendencias.salvar(novo);
        if (!nome) return;
        const emp = (novo.empresas || [])[0];
        if (emp) localStorage.setItem(`revisao.ultimaPendencia.${emp}`, JSON.stringify({ data: novo.data, salvoEm: novo.geradoEm, nome }));
        this._lembrete();
        alert(`Salvo em ${nome}: ${novo.itens.length} item(ns) que ainda faltam.`);
    },


    // ==========================================================
    // AUXILIARES
    // ==========================================================

    _aba(id) {
        document.querySelectorAll("[data-rv-aba]").forEach(b => b.classList.toggle("ativo", b.dataset.rvAba === id));
        document.getElementById("rv-resultado").classList.toggle("hidden", id !== "revisar");
        document.getElementById("rv-conferencia").classList.toggle("hidden", id !== "conferir");
        document.getElementById("rv-painel-revisar").classList.toggle("hidden", id !== "revisar");
        document.getElementById("rv-painel-conferir").classList.toggle("hidden", id !== "conferir");
    },

    _loader(msg) {
        const l = document.getElementById("loader");
        if (!msg) return l.classList.add("hidden");
        l.querySelector("p").innerText = msg;
        l.classList.remove("hidden");
    },

    _ontemISO() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
    },

    _fmt(s) {
        return s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
    },

    _esc(s) {
        return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }
};
