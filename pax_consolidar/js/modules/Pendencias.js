// ============================================================
// Pendencias.js — Pendências do GPS Cittati entre um dia e outro
//
// O operador corrige na Cittati o que a análise apontou, mas a correção
// só aparece no BI depois da atualização seguinte (de madrugada). Por
// isso a análise salva um arquivo com as pendências do dia, e num dia
// seguinte esse arquivo é conferido contra o BI atualizado.
//
//   salvarDaAnalise() — monta o arquivo a partir do último "Processar"
//                       do modal de Anomalias (abas Cittati + omissões
//                       com passageiro) e baixa o .json
//   abrirArquivo()    — lê o arquivo, busca o mesmo dia no serviço
//                       Cittati e mostra o que foi resolvido
//   avaliar()         — função pura: item a item, a situação atual
//
// A conferência não precisa de bilhetagem: cada tipo de pendência tem
// uma regra de "resolvida" que só olha os dados da Cittati (_resolvida).
//
// Situação de cada item:
//   resolvida      — a regra do tipo foi atendida e não surgiu problema novo
//   alterada       — a viagem mudou mas a regra ainda não foi atendida,
//                    ou foi atendida e surgiu outro problema: revisar
//   pendente       — nada mudou
//   nao_encontrada — a viagem não está mais no BI (nem pelo id, nem pela
//                    chave linha + sentido + tabela + início previsto)
// ============================================================

const Pendencias = {

    TIPO_ARQUIVO: "flow-pendencias-cittati",
    VERSAO: 1,

    SITUACOES: {
        pendente:       { label: "Pendente",          cor: "var(--danger)" },
        alterada:       { label: "Alterada — revisar", cor: "var(--warning)" },
        nao_encontrada: { label: "Não encontrada",    cor: "var(--text-3)" },
        resolvida:      { label: "Resolvida",         cor: "var(--success)" }
    },

    // Estado da tela de conferência
    _arquivo:     null,
    _meta:        null,
    _resultados:  [],
    _dispensados: new Set(),

    tipoLabel(tipo) {
        return tipo === "omissao_com_pax" ? "Omissão com passageiro" : (CittatiAnalises.TIPOS[tipo] || tipo);
    },


    // ==========================================================
    // GERAR — a partir da análise do modal de Anomalias
    // ==========================================================

    salvarDaAnalise() {
        const session = AppState.session;
        if (!session || !session.viagens.some(v => v.cittati)) {
            return alert("Pendências só existem com o GPS Cittati.");
        }

        const itens = [];
        const vistos = new Set();
        const add = (tipo, v, extra) => {
            const k = `${v.cittati.id}|${tipo}`;
            if (vistos.has(k)) return;
            vistos.add(k);
            const it = this._item(tipo, v, extra);
            // Já atende a regra (ex.: metade de ida quebrada com motivo "#"):
            // aparece na aba como contexto, mas não é pendência
            if (!this._resolvida(tipo, it.antes)) itens.push(it);
        };

        // Abas Cittati (motivos, parciais, ponto final)
        for (const lista of Object.values(Anomalies._cittatiItens || {})) {
            for (const x of lista) {
                add(x.tipo, x.viagem, {
                    parte:     x.parte || null,
                    parId:     x.par ? x.par.cittati.id : null,
                    indicio:   x.indicio ?? null,
                    paxJanela: x.paxJanela ?? null
                });
            }
        }

        // Omissões com passageiro: cada omissão do card vira um item.
        // Card ignorado no modal (removido da tela) não entra.
        for (const [key, s] of Object.entries(Anomalies._pendentes || {})) {
            if (!key.startsWith("o_") || !document.getElementById(`anomalies-card-${key}`)) continue;
            const carros = s.carrosSuspeitos.map(c => ({ veiculo: c.veiculo, pax: c.paxNaJanela.length, pct: c.percentual }));
            s.omissoes.forEach((v, i) => {
                if (v.cittati) add("omissao_com_pax", v, { parte: s.omissoes.length > 1 ? i + 1 : null, total: s.omissoes.length, carros });
            });
        }

        if (itens.length === 0) return alert("Nenhuma pendência para salvar. Rode a análise (Processar) antes.");

        const meta = session.cittatiMeta || {};
        const data = meta.data || this._isoDeBR(session.viagens.find(v => v.cittati)?.data);
        const arquivo = {
            tipo:           this.TIPO_ARQUIVO,
            versao:         this.VERSAO,
            data,
            geradoEm:       new Date().toISOString(),
            biAtualizadoEm: meta.biAtualizadoEm || null,
            rodada:         1,
            comBilhetagem:  !!session.temBilhetagem,
            empresas:       [...new Set(itens.map(it => it.empresa))].sort(),
            itens
        };
        this._baixar(arquivo);
    },

    // Um item: chave para reencontrar a viagem + retrato dela no momento
    _item(tipo, v, extra = {}) {
        const c = v.cittati;
        return {
            tipo,
            empresa: v.empresa,
            chave: {
                id:         c.id,
                empresaBI:  c.empresaBI,
                linha_base: v.linha_base,
                sentido:    v.sentido,
                tabela:     v.tabela,
                prevInicio: c.prevInicio
            },
            desde: null,                 // preenchido no _baixar (data da 1ª vez que foi salvo)
            antes: this._retrato(v),
            ...extra
        };
    },

    // O que se compara entre uma conferência e outra (serve para viagem
    // do Session e para linha do Cittati.paraGps: os campos são os mesmos)
    _retrato(r) {
        const c = r.cittati;
        return {
            linha:           r.linha,
            rota:            c.rota,
            veiculo:         r.veiculo,
            realizadaBI:     c.realizadaBI,
            parcial:         c.parcial,
            prevInicio:      c.prevInicio,
            prevFim:         c.prevFim,
            mPrevInicio:     c.mPrevInicio,
            realInicio:      c.realInicio,
            realFim:         c.realFim,
            motivo:          c.motivo,
            motivoRealizada: c.motivoRealizada,
            pontoFinal:      c.pontoFinal,
            pontoFinalRota:  c.pontoFinalRota,
            pontoAlterado:   c.pontoAlterado
        };
    },

    // Nome: pendencias_cittati_<empresa>_<data>[_rN].json (empresa só quando é uma)
    nomeArquivo(arquivo) {
        const emp = arquivo.empresas?.length === 1
            ? "_" + arquivo.empresas[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\W+/g, "")
            : "";
        return `pendencias_cittati${emp}_${arquivo.data}${arquivo.rodada > 1 ? `_r${arquivo.rodada}` : ""}.json`;
    },

    // Salva o arquivo. Com o seletor de arquivos do navegador (Chrome/Edge),
    // o operador escolhe a pasta combinada e o navegador lembra dela da
    // próxima vez; sem ele, vai para Downloads. Retorna o nome salvo, ou
    // null se o operador cancelou.
    async salvar(arquivo) {
        const agora = arquivo.geradoEm;
        for (const it of arquivo.itens) it.desde = it.desde || agora;
        const nome  = this.nomeArquivo(arquivo);
        const texto = JSON.stringify(arquivo, null, 1);

        if (window.showSaveFilePicker) {
            try {
                const h = await window.showSaveFilePicker({
                    id: "pendencias-cittati", suggestedName: nome,
                    types: [{ description: "Pendências Cittati", accept: { "application/json": [".json"] } }]
                });
                const w = await h.createWritable();
                await w.write(texto);
                await w.close();
                return h.name;
            } catch (err) {
                if (err.name === "AbortError") return null;
                console.warn("[Pendencias] seletor de arquivo falhou, baixando:", err);
            }
        }
        const url = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
        const a   = Object.assign(document.createElement("a"), { href: url, download: nome });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return nome;
    },

    async _baixar(arquivo) {
        const nome = await this.salvar(arquivo);
        if (nome && typeof UIController !== "undefined") {
            UIController.setStatusBadge(`${arquivo.itens.length} pendência(s) salvas em ${nome}`, "success");
        }
    },

    // Novo arquivo com o que não foi resolvido nem ficou de fora (excluir:
    // índices de resultados). O retrato "antes" passa a ser o de agora: na
    // próxima conferência, "alterada" quer dizer "mudou desde esta".
    restantes(arquivo, resultados, excluir, meta) {
        const itens = resultados
            .filter((r, i) => r.situacao !== "resolvida" && !excluir.has(i))
            .map(r => r.agora ? { ...r.item, antes: r.agora, chave: { ...r.item.chave, id: r.atual.cittati.id } } : r.item);
        return {
            ...arquivo,
            geradoEm:       new Date().toISOString(),
            biAtualizadoEm: meta?.biAtualizadoEm || null,
            rodada:         (arquivo.rodada || 1) + 1,
            empresas:       [...new Set(itens.map(it => it.empresa))].sort(),
            itens
        };
    },


    // ==========================================================
    // CONFERIR — arquivo de pendências × BI atualizado
    // ==========================================================

    async abrirArquivo(file) {
        if (!file) return;
        let arquivo;
        try {
            arquivo = JSON.parse(await file.text());
            this.validar(arquivo);
        } catch (err) {
            return alert(`Erro: ${err instanceof SyntaxError ? "o arquivo não é um JSON válido." : err.message}`);
        }

        UIController.showLoader(`Buscando viagens da Cittati de ${Cittati.isoParaBR(arquivo.data)}...`);
        try {
            const { linhas, meta } = await this._viagensAtuais(arquivo.data);
            this._arquivo     = arquivo;
            this._meta        = meta;
            this._resultados  = this.avaliar(arquivo, linhas);
            this._dispensados = new Set();
            this._abrirModal(file.name);
        } catch (err) {
            alert(`Erro: ${err.message}`);
        } finally {
            UIController.hideLoader();
        }
    },

    validar(arquivo) {
        if (!arquivo || arquivo.tipo !== this.TIPO_ARQUIVO) {
            throw new Error("Arquivo não é de pendências da Cittati.");
        }
        if (arquivo.versao > this.VERSAO) {
            throw new Error(`Arquivo de pendências de uma versão mais nova (${arquivo.versao}). Atualize o Flow.`);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(arquivo.data || "") || !Array.isArray(arquivo.itens)) {
            throw new Error("Arquivo de pendências incompleto (faltam \"data\" ou \"itens\").");
        }
    },

    // Viagens do dia: do serviço; se ele estiver fora, do GPS Cittati já
    // carregado na tela, desde que seja o mesmo dia
    async _viagensAtuais(data) {
        try {
            const r = await Cittati.viagensDoDia(data);
            return {
                linhas: Cittati.paraGps(r),
                meta: { biAtualizadoEm: r.biAtualizadoEm || null, geradoEm: r.geradoEm || null, origem: "serviço" }
            };
        } catch (err) {
            const m = typeof AppState !== "undefined" ? AppState.cittatiMeta : null;
            if (m && AppState.gpsFonte === "cittati" && m?.data === data && AppState.rawGps?.length) {
                return {
                    linhas: AppState.rawGps,
                    meta: { biAtualizadoEm: m.biAtualizadoEm, geradoEm: m.geradoEm, origem: m.origem, erroServico: err.message }
                };
            }
            throw new Error(
                `${err.message}\n\nSem o serviço, carregue no card de GPS o .json da Cittati de ` +
                `${Cittati.isoParaBR(data)} e abra as pendências de novo.`
            );
        }
    },

    // Função pura. linhas: saída do Cittati.paraGps do mesmo dia.
    avaliar(arquivo, linhas) {
        const porId    = new Map();
        const porChave = new Map();
        for (const l of linhas) {
            porId.set(String(l.cittati.id), l);
            const k = this._chaveComposta({
                empresaBI: l.cittati.empresaBI, linha_base: l.linha_base, sentido: l.sentido,
                tabela: l.tabela, prevInicio: l.cittati.prevInicio
            });
            (porChave.get(k) || porChave.set(k, []).get(k)).push(l);
        }

        return arquivo.itens.map(item => {
            let atual = porId.get(String(item.chave.id)) || null;
            let via   = "id";
            if (!atual) {
                const cand = porChave.get(this._chaveComposta(item.chave)) || [];
                if (cand.length === 1) { atual = cand[0]; via = "chave"; }
            }
            if (!atual) return { item, atual: null, agora: null, via: null, situacao: "nao_encontrada", mudancas: [], novos: [] };

            const agora    = this._retrato(atual);
            const mudancas = this._mudancas(item.antes, agora);
            const jaTinha  = new Set([item.tipo, ...this._problemas(item.antes)]);
            const novos    = this._problemas(agora).filter(t => !jaTinha.has(t));
            const ok       = this._resolvida(item.tipo, agora);

            const situacao = ok ? (novos.length ? "alterada" : "resolvida")
                           : mudancas.length ? "alterada" : "pendente";
            return { item, atual, agora, via, situacao, mudancas, novos };
        });
    },

    _chaveComposta(k) {
        return [k.empresaBI, k.linha_base, k.sentido, k.tabela, k.prevInicio].map(x => String(x ?? "")).join("|");
    },

    // Quando a pendência deixa de existir, olhando só os dados da Cittati
    _resolvida(tipo, r) {
        switch (tipo) {
            case "omissao_sem_motivo":     return r.realizadaBI || !!r.motivo;
            case "realizada_com_motivo":   return !(r.realizadaBI && r.motivo);
            case "justificativa_suspeita": return r.realizadaBI || !r.motivoRealizada;
            case "inicio_sem_fim":
            case "fim_sem_inicio":
            case "ida_quebrada":
            case "omissao_com_pax":        return r.realizadaBI || !!r.motivoRealizada;
            case "ponto_alterado":         return !r.pontoAlterado;
            default:                       return false;
        }
    },

    // Problemas que dá para ver numa viagem sem bilhetagem
    _problemas(r) {
        const p = [];
        if (r.realizadaBI && r.motivo)   p.push("realizada_com_motivo");
        if (!r.realizadaBI && !r.motivo) p.push("omissao_sem_motivo");
        if (r.parcial && !r.motivoRealizada) p.push(r.parcial);
        if (r.pontoAlterado)             p.push("ponto_alterado");
        return p;
    },

    _mudancas(a, b) {
        const hora = s => Cittati._hora(s) || "—";
        const sn   = x => (x ? "Sim" : "Não");
        const m = [];
        if (a.realizadaBI !== b.realizadaBI) m.push(`realizada: ${sn(a.realizadaBI)} → ${sn(b.realizadaBI)}`);
        if (a.realInicio !== b.realInicio || a.realFim !== b.realFim) {
            m.push(`real: ${hora(a.realInicio)}–${hora(a.realFim)} → ${hora(b.realInicio)}–${hora(b.realFim)}`);
        }
        if (a.motivo !== b.motivo)         m.push(`motivo: ${a.motivo || "—"} → ${b.motivo || "—"}`);
        if (a.pontoFinal !== b.pontoFinal) m.push(`ponto final: ${a.pontoFinal || "—"} → ${b.pontoFinal || "—"}`);
        if (a.veiculo !== b.veiculo)       m.push(`carro: ${a.veiculo || "—"} → ${b.veiculo || "—"}`);
        return m;
    },

    // Aviso quando o BI ainda não pode mostrar as correções
    _avisoAtualizacao(arquivo, meta) {
        const fmt   = s => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
        const bi    = meta.biAtualizadoEm ? Date.parse(meta.biAtualizadoEm) : NaN;
        const salvo = Date.parse(arquivo.geradoEm);
        if (isNaN(bi)) {
            return "Não dá para saber quando o BI foi atualizado (dados vindos de arquivo). " +
                   "Se o arquivo da Cittati for anterior às correções, elas não vão aparecer.";
        }
        if (!isNaN(salvo) && bi <= salvo) {
            return `O BI foi atualizado em ${fmt(bi)}, antes de as pendências serem salvas (${fmt(salvo)}). ` +
                   "Nenhuma correção feita depois disso aparece ainda: o BI atualiza de madrugada, " +
                   "então confira de novo depois da próxima atualização.";
        }
        return "";
    },


    // ==========================================================
    // TELA DE CONFERÊNCIA
    // ==========================================================

    _abrirModal(nomeArquivo) {
        document.getElementById("pendencias-overlay")?.remove();
        document.body.classList.add("modal-open");

        const arq  = this._arquivo, meta = this._meta;
        const esc  = s => Anomalies._esc(s);
        const fmt  = s => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
        const res  = this._resultados;
        const cont = Object.fromEntries(Object.keys(this.SITUACOES).map(k => [k, res.filter(r => r.situacao === k).length]));

        const avisos = [
            this._avisoAtualizacao(arq, meta),
            meta.erroServico ? `Serviço indisponível (${meta.erroServico}); usando o GPS carregado na tela (${meta.origem}).` : "",
            res.some(r => r.via === "chave") ? "Algumas viagens mudaram de id no BI e foram reencontradas por linha + sentido + tabela + início previsto." : ""
        ].filter(Boolean);

        const uniq = f => [...new Set(res.map(f).filter(Boolean))].sort();
        const opts = arr => arr.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
        const sel  = `class="input" style="height:30px; font-size:0.82rem; min-width:120px;" onchange="Pendencias._filtrar()"`;
        const lbl  = `style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-3); margin-bottom:4px;"`;
        const th   = `style="padding:6px 8px; color:var(--text-3); font-size:0.7rem; text-align:left; border-bottom:1px solid var(--border); white-space:nowrap;"`;

        const contadores = Object.entries(this.SITUACOES).map(([k, s]) => `
            <button onclick="Pendencias._filtrarSituacao('${k}')" class="btn btn-ghost"
                style="display:flex; flex-direction:column; align-items:flex-start; gap:2px; padding:10px 16px; height:auto; border-left:3px solid ${s.cor};">
                <span style="font-size:1.3rem; font-family:var(--mono); color:${s.cor};">${cont[k]}</span>
                <span style="font-size:0.72rem; color:var(--text-3);">${s.label}</span>
            </button>`).join("");

        document.body.insertAdjacentHTML("beforeend", `
            <div id="pendencias-overlay" style="position:fixed; inset:0; z-index:2000; background:var(--bg); overflow-y:auto;">
                <div style="max-width:1300px; margin:0 auto; padding:24px 32px 48px;">

                    <div style="display:flex; justify-content:space-between; align-items:center;
                                margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid var(--border);">
                        <div>
                            <h2 style="font-size:1.1rem; color:var(--primary); margin:0 0 4px;">
                                Pendências Cittati de ${Cittati.isoParaBR(arq.data)}${arq.rodada > 1 ? ` · conferência ${arq.rodada}` : ""}
                            </h2>
                            <div style="font-size:0.78rem; color:var(--text-3);">
                                ${esc(nomeArquivo)} · salvas em ${fmt(arq.geradoEm)} · ${res.length} item(ns) ·
                                BI atualizado em ${fmt(meta.biAtualizadoEm)} (${esc(meta.origem)})
                            </div>
                        </div>
                        <button onclick="Pendencias._fecharModal()" class="btn btn-ghost">✕ Fechar</button>
                    </div>

                    ${avisos.map(a => `
                        <div style="border:1px solid var(--warning); background:var(--bg-2); color:var(--text-2); border-radius:6px;
                                    padding:10px 14px; margin-bottom:10px; font-size:0.82rem; line-height:1.5;">⚠ ${esc(a)}</div>`).join("")}

                    <div style="display:flex; gap:10px; flex-wrap:wrap; margin:14px 0;">${contadores}</div>

                    <p style="font-size:0.78rem; color:var(--text-3); margin:0 0 6px; line-height:1.5;">
                        Resolvida: a regra do tipo foi atendida na Cittati. Alterada: a viagem mudou, mas a regra ainda não foi
                        atendida ou surgiu outro problema. ✕ dispensa o item (conferido, não precisa corrigir) e ele não vai para
                        o arquivo de restantes.
                    </p>

                    <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; background:var(--bg-2);
                                border:1px solid var(--border); border-radius:6px; padding:10px 14px; margin:10px 0 14px;">
                        <div><div ${lbl}>Situação</div><select id="pf-situacao" ${sel}><option value="">Todas</option>
                            ${Object.entries(this.SITUACOES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join("")}</select></div>
                        <div><div ${lbl}>Empresa</div><select id="pf-empresa" ${sel}><option value="">Todas</option>${opts(uniq(r => r.item.empresa))}</select></div>
                        <div><div ${lbl}>Linha</div><select id="pf-linha" ${sel}><option value="">Todas</option>${opts(uniq(r => r.item.chave.linha_base))}</select></div>
                        <div><div ${lbl}>Tipo</div><select id="pf-tipo" ${sel}><option value="">Todos</option>
                            ${uniq(r => r.item.tipo).map(t => `<option value="${t}">${esc(this.tipoLabel(t))}</option>`).join("")}</select></div>
                        <span id="pf-contador" style="font-size:0.78rem; color:var(--text-3); align-self:center;"></span>
                        <div style="margin-left:auto; display:flex; gap:8px;">
                            <button onclick="Pendencias._exportCSV()" class="btn btn-ghost" style="font-size:0.78rem; height:30px;">↓ CSV</button>
                            <button onclick="Pendencias._salvarRestantes()" class="btn btn-primary" style="font-size:0.78rem; height:30px;">
                                Salvar restantes
                            </button>
                        </div>
                    </div>

                    <div style="overflow-x:auto; border:1px solid var(--border); border-radius:6px;">
                        <table style="width:100%; font-size:0.8rem; border-collapse:collapse;">
                            <thead><tr style="background:var(--bg-3);">
                                <th ${th}></th><th ${th}>Situação</th><th ${th}>Tipo</th><th ${th}>Empresa</th><th ${th}>Linha</th><th ${th}>Rota</th>
                                <th ${th}>Tab</th><th ${th}>Carro</th><th ${th}>Previsto</th><th ${th}>Agora</th><th ${th}>O que mudou</th>
                            </tr></thead>
                            <tbody id="pf-corpo">${this._ordenados().map(i => this._htmlLinha(i)).join("")}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `);
        this._filtrar();
    },

    // Índices de _resultados na ordem da tabela
    _ordenados() {
        const ordem = Object.keys(this.SITUACOES);
        const res   = this._resultados;
        return res.map((_, i) => i).sort((a, b) => {
            const x = res[a], y = res[b];
            return ordem.indexOf(x.situacao) - ordem.indexOf(y.situacao)
                || x.item.empresa.localeCompare(y.item.empresa)
                || x.item.chave.linha_base.localeCompare(y.item.chave.linha_base)
                || (x.item.antes.mPrevInicio ?? 0) - (y.item.antes.mPrevInicio ?? 0);
        });
    },

    _htmlLinha(idx) {
        const r   = this._resultados[idx];
        const it  = r.item, k = it.chave;
        const ret = r.agora || it.antes;
        const esc = s => Anomalies._esc(s);
        const sit = this.SITUACOES[r.situacao];
        const td  = (c, extra = "") => `<td style="padding:5px 8px; border-bottom:1px solid var(--border); ${extra}">${c}</td>`;
        const h   = s => Cittati._hora(s) || "—";

        let tipo = esc(this.tipoLabel(it.tipo));
        if (it.parte) tipo += ` (${it.parte}/${it.total || 2})`;
        if (it.tipo === "omissao_com_pax" && it.carros?.length) {
            tipo += `<div style="font-size:0.7rem; color:var(--text-3);">carros: ${it.carros.map(c => `${esc(c.veiculo)} (${c.pax})`).join(", ")}</div>`;
        }

        const agora = r.agora
            ? `${r.agora.realizadaBI ? "realizada" : "não realizada"} · ${h(r.agora.realInicio)} → ${h(r.agora.realFim)}` +
              `<div style="font-size:0.72rem; color:var(--text-3);">${esc(r.agora.motivo || "sem motivo")}</div>`
            : "—";
        const mudou = [
            ...r.mudancas.map(esc),
            ...r.novos.map(t => `<span style="color:var(--warning);">agora: ${esc(this.tipoLabel(t))}</span>`)
        ].join("<br>") || `<span style="color:var(--text-3);">—</span>`;

        return `
            <tr data-idx="${idx}" data-situacao="${r.situacao}" data-empresa="${esc(it.empresa)}"
                data-linha="${esc(k.linha_base)}" data-tipo="${it.tipo}">
                ${td(`<button onclick="Pendencias._dispensar(${idx})" class="btn btn-ghost" title="Dispensar: conferido, não precisa corrigir"
                        style="font-size:0.72rem; padding:2px 8px;">✕</button>`)}
                ${td(sit.label, `color:${sit.cor}; white-space:nowrap;`)}
                ${td(tipo)}
                ${td(esc(it.empresa))}
                ${td(esc(ret.linha), "white-space:nowrap;")}
                ${td(esc(ret.rota))}
                ${td(esc(k.tabela))}
                ${td(esc(ret.veiculo) || "—", "font-family:var(--mono);")}
                ${td(`${h(it.antes.prevInicio)} → ${h(it.antes.prevFim)}`, "font-family:var(--mono); white-space:nowrap;")}
                ${td(agora, "white-space:nowrap;")}
                ${td(mudou, "font-size:0.76rem;")}
            </tr>`;
    },

    _filtrarSituacao(situacao) {
        const s = document.getElementById("pf-situacao");
        if (s) s.value = s.value === situacao ? "" : situacao;
        this._filtrar();
    },

    _filtrar() {
        const val = k => document.getElementById(`pf-${k}`)?.value || "";
        const f = { situacao: val("situacao"), empresa: val("empresa"), linha: val("linha"), tipo: val("tipo") };
        let n = 0;
        document.querySelectorAll("#pf-corpo tr").forEach(tr => {
            const ok = Object.entries(f).every(([k, v]) => !v || tr.dataset[k] === v);
            tr.style.display = ok ? "" : "none";
            if (ok) n++;
        });
        const cont = document.getElementById("pf-contador");
        if (cont) cont.innerText = `${n} item(ns)` + (this._dispensados.size ? ` · ${this._dispensados.size} dispensado(s)` : "");
    },

    _dispensar(idx) {
        const tr = document.querySelector(`#pf-corpo tr[data-idx="${idx}"]`);
        if (this._dispensados.has(idx)) this._dispensados.delete(idx);
        else this._dispensados.add(idx);
        if (tr) {
            const fora = this._dispensados.has(idx);
            tr.style.opacity        = fora ? "0.4" : "";
            tr.style.textDecoration = fora ? "line-through" : "";
        }
        this._filtrar();
    },

    // Novo arquivo com o que não foi resolvido nem dispensado. O retrato
    // "antes" passa a ser o de agora: na próxima conferência, "alterada"
    // quer dizer "mudou desde esta conferência".
    _salvarRestantes() {
        const novo = this.restantes(this._arquivo, this._resultados, this._dispensados, this._meta);
        if (novo.itens.length === 0) return alert("Nada restante: tudo resolvido ou dispensado.");
        this._baixar(novo);
    },

    _exportCSV() {
        const rows = [["Situação", "Tipo", "Empresa", "Linha", "Rota", "Tabela", "Carro", "Previsto início", "Previsto fim",
                       "Realizada agora", "Real início agora", "Real fim agora", "Motivo agora", "O que mudou", "Dispensado", "Id Cittati"]];
        document.querySelectorAll("#pf-corpo tr").forEach(tr => {
            if (tr.style.display === "none") return;
            const i = +tr.dataset.idx, r = this._resultados[i];
            const it = r.item, a = r.agora, ret = a || it.antes;
            rows.push([
                this.SITUACOES[r.situacao].label,
                this.tipoLabel(it.tipo) + (it.parte ? ` (${it.parte}/${it.total || 2})` : ""),
                it.empresa, ret.linha, ret.rota, it.chave.tabela, ret.veiculo,
                it.antes.prevInicio, it.antes.prevFim,
                a ? (a.realizadaBI ? "Sim" : "Não") : "", a?.realInicio || "", a?.realFim || "", a?.motivo || "",
                [...r.mudancas, ...r.novos.map(t => `agora: ${this.tipoLabel(t)}`)].join(" | "),
                this._dispensados.has(i) ? "Sim" : "",
                r.atual?.cittati.id ?? it.chave.id
            ]);
        });
        Anomalies._downloadCSV(rows, `pendencias_cittati_${this._arquivo.data}`);
    },

    _fecharModal() {
        document.getElementById("pendencias-overlay")?.remove();
        document.body.classList.remove("modal-open");
    },

    // "25/11/2026" → "2026-11-25"
    _isoDeBR(s) {
        const m = String(s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
    }
};
