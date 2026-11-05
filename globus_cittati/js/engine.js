// ============================================================
// engine.js — Regras da limpeza Globus → Cittati
//
// Funções puras, sem DOM. O layout de saída é o mesmo de entrada
// (28 campos separados por ";"), sem cabeçalho.
//
//   analisar(texto)            → lê, remove códigos e classifica os dias
//   resolver(analise, decisoes) → aplica as correções e gera o arquivo final
// ============================================================
const GlobusEngine = (() => {

    const TOTAL_CAMPOS = 28;

    const COL = {
        LINHA: 0, TIPO_DIA: 1, PROGRAMACAO: 2, TABELA: 4, SAIDA: 5, CHEGADA: 6, SEQ: 7, CODIGO: 8, FLAG: 9, SENTIDO: 10,
        H_INICIO: 11, H_FIM: 12, DIA_INICIO: 13, DIA_FIM: 14,
        QTD_VIAGENS: 19, QTD_VEICULOS: 20, DATA_ESCALA: 21, PREFIXO: 22, MATRICULA: 23, NOME: 25,
    };

    // Vazio = viagem normal: o Globus não preenche o código nesses eventos
    const CODIGOS_PERMITIDOS = new Set(["", "2", "3", "5", "8", "10"]);

    // Ordem de exibição das críticas; as resumidas aparecem em uma linha só na tela
    const ORDEM_CRITICAS = [
        "Tabela sem carro", "Tabela sem condutor", "Carro sobreposto", "Condutor sobreposto",
        "Horário incoerente", "Viagens não conferem", "Improdutivo sem código",
    ];
    const CRITICAS_RESUMIDAS = new Set(["Improdutivo sem código"]);

    // Recuo de horário maior que isso é virada de dia; menor é horário incoerente
    const MEIO_DIA = 720;

    // ----------------------------------------------------------
    // Utilitários
    // ----------------------------------------------------------
    function minutos(hhmm) {
        const h = hhmm.padStart(4, "0");
        return Number(h.slice(0, 2)) * 60 + Number(h.slice(2));
    }

    function formatarHora(hhmm) {
        const h = hhmm.padStart(4, "0");
        return `${h.slice(0, 2)}:${h.slice(2)}`;
    }

    function horaValida(valor) {
        return /^\d{3,4}$/.test(valor) && minutos(valor) < 1440 && Number(valor.slice(-2)) < 60;
    }

    function dadosEvento(campos) {
        return {
            data: campos[COL.DATA_ESCALA],
            linha: campos[COL.LINHA],
            tabela: campos[COL.TABELA],
            seq: campos[COL.SEQ],
            inicio: formatarHora(campos[COL.H_INICIO]),
            fim: formatarHora(campos[COL.H_FIM]),
        };
    }

    // ----------------------------------------------------------
    // Leitura
    // ----------------------------------------------------------
    function parsear(texto) {
        const eventos = [];
        const erros = [];

        texto.split(/\r?\n/).forEach((linha, i) => {
            if (!linha.trim()) return;
            const numero = i + 1;
            const campos = linha.split(";");

            if (campos.length !== TOTAL_CAMPOS) {
                erros.push(`linha ${numero}: ${campos.length} campos (esperado ${TOTAL_CAMPOS})`);
            } else if (!horaValida(campos[COL.H_INICIO]) || !horaValida(campos[COL.H_FIM])) {
                erros.push(`linha ${numero}: horário inválido`);
            } else if (![COL.SEQ, COL.DIA_INICIO, COL.DIA_FIM].every(c => /^\d+$/.test(campos[c]))) {
                erros.push(`linha ${numero}: sequência ou dia inválido`);
            } else {
                eventos.push({ numero, campos });
            }
        });

        if (erros.length) {
            const resto = erros.length > 5 ? `\n... e mais ${erros.length - 5}` : "";
            throw new Error(`Arquivo fora do layout:\n${erros.slice(0, 5).join("\n")}${resto}`);
        }
        if (!eventos.length) throw new Error("Arquivo sem eventos.");
        return eventos;
    }

    // Um arquivo pode trazer vários dias: a mesma tabela existe em cada data
    function agruparTabelas(eventos) {
        const grupos = new Map();
        for (const evento of eventos) {
            const { campos } = evento;
            const chave = [campos[COL.DATA_ESCALA], campos[COL.TIPO_DIA], campos[COL.LINHA], campos[COL.TABELA]].join("|");
            if (!grupos.has(chave)) {
                grupos.set(chave, {
                    chave,
                    data: campos[COL.DATA_ESCALA],
                    linha: campos[COL.LINHA],
                    tabela: campos[COL.TABELA],
                    eventos: [],
                });
            }
            grupos.get(chave).eventos.push(evento);
        }
        for (const grupo of grupos.values()) {
            grupo.eventos.sort((a, b) => Number(a.campos[COL.SEQ]) - Number(b.campos[COL.SEQ]));
        }
        return [...grupos.values()];
    }

    // ----------------------------------------------------------
    // Regra de dia: só avança quando o horário vira a meia-noite.
    //
    // Roda antes de descartar os eventos removidos, porque um deles pode
    // ser o único registro da virada (031 NOT: 23:50–00:00, código 11).
    // Removidos sem duração ficam de fora: são marcos no meio da viagem,
    // com horário anterior ao fim dela (309: viagem até 05:44, marco 05:09).
    // ----------------------------------------------------------
    function marcarRemovidos(grupo) {
        grupo.eventos.forEach((evento, i) => {
            const { campos } = evento;
            const codigo = campos[COL.CODIGO].trim();
            const ultimo = i === grupo.eventos.length - 1;

            if (!CODIGOS_PERMITIDOS.has(codigo)) {
                evento.motivoRemocao = `código ${codigo}`;
            } else if (!codigo && campos[COL.FLAG] === "0" && campos[COL.SENTIDO] === "C" && !ultimo) {
                // Só informativo. O do fim da tabela fica: é um fechamento sem código (crítica)
                evento.motivoRemocao = "informativo, sentido C";
            }
        });
    }

    function virouMeiaNoite(de, para) {
        return de - para > MEIO_DIA;
    }

    function semDuracao({ campos }) {
        return campos[COL.H_INICIO] === campos[COL.H_FIM];
    }

    function calcularDias(eventos) {
        const dias = new Map();
        let dia = 1;
        let fimAnterior = null;

        for (const evento of eventos) {
            const inicio = minutos(evento.campos[COL.H_INICIO]);
            const fim = minutos(evento.campos[COL.H_FIM]);

            if (fimAnterior !== null && virouMeiaNoite(fimAnterior, inicio)) dia++;
            const diaInicio = dia;
            if (virouMeiaNoite(inicio, fim)) dia++;
            fimAnterior = fim;

            dias.set(evento, { inicio: diaInicio, fim: dia });
        }
        return dias;
    }

    // automatica: dia avançou sem virar a meia-noite (o erro conhecido do Globus)
    // duvida: a regra não explica o arquivo, quem decide é o usuário
    function classificarDias(grupo) {
        const diaInicial = Number(grupo.eventos[0].campos[COL.DIA_INICIO]);
        const esperados = calcularDias(grupo.eventos.filter(e => !e.motivoRemocao || !semDuracao(e)));
        const divergencias = [];

        grupo.eventos = grupo.eventos.filter(e => !e.motivoRemocao);
        for (const evento of grupo.eventos) {
            const esperado = esperados.get(evento);
            const atual = {
                inicio: Number(evento.campos[COL.DIA_INICIO]),
                fim: Number(evento.campos[COL.DIA_FIM]),
            };
            if (atual.inicio !== esperado.inicio || atual.fim !== esperado.fim) {
                divergencias.push({ evento, atual, esperado });
            }
        }

        grupo.divergencias = divergencias;
        grupo.motivoDuvida = null;
        if (!divergencias.length) return;

        if (diaInicial > 1) {
            grupo.motivoDuvida = `Tabela inicia no dia ${diaInicial}`;
        } else if (divergencias.some(d => d.atual.inicio < d.esperado.inicio || d.atual.fim < d.esperado.fim)) {
            grupo.motivoDuvida = "Virada de meia-noite sem o dia avançar no arquivo";
        }
    }

    // ----------------------------------------------------------
    // Código de programação ausente: agrupa por linha e sugere o
    // código da própria linha ou da linha sem a letra final (308B → 308)
    // ----------------------------------------------------------
    function codigoMaisFrequente(eventos, data, linha) {
        const contagem = new Map();
        for (const { campos } of eventos) {
            const codigo = campos[COL.PROGRAMACAO].trim();
            if (campos[COL.DATA_ESCALA] === data && campos[COL.LINHA] === linha && codigo) {
                contagem.set(codigo, (contagem.get(codigo) || 0) + 1);
            }
        }
        const [maisFrequente] = [...contagem].sort((a, b) => b[1] - a[1]);
        return maisFrequente ? maisFrequente[0] : "";
    }

    function chaveDataLinha(campos) {
        return `${campos[COL.DATA_ESCALA]}|${campos[COL.LINHA]}`;
    }

    function listarSemProgramacao(eventos) {
        const porLinha = new Map();
        for (const { campos } of eventos) {
            if (campos[COL.PROGRAMACAO].trim()) continue;
            const chave = chaveDataLinha(campos);
            porLinha.set(chave, (porLinha.get(chave) || 0) + 1);
        }

        return [...porLinha].map(([chave, totalEventos]) => {
            const [data, linha] = chave.split("|");
            return {
                chave,
                data,
                linha,
                totalEventos,
                sugestao: codigoMaisFrequente(eventos, data, linha)
                    || codigoMaisFrequente(eventos, data, linha.replace(/[A-Za-z]+$/, "")),
            };
        });
    }

    function analisar(texto) {
        const eventos = parsear(texto);
        const grupos = agruparTabelas(eventos);
        grupos.forEach(marcarRemovidos);

        const removidos = eventos.filter(e => e.motivoRemocao);
        const mantidos = eventos.filter(e => !e.motivoRemocao);

        grupos.forEach(classificarDias);

        return {
            eol: texto.includes("\r\n") ? "\r\n" : "\n",
            terminaComQuebra: /\n$/.test(texto),
            totalLinhas: eventos.length,
            removidos,
            grupos: grupos.filter(g => g.eventos.length),
            duvidas: grupos.filter(g => g.motivoDuvida),
            semProgramacao: listarSemProgramacao(mantidos),
        };
    }

    // ----------------------------------------------------------
    // Geração do arquivo final
    // ----------------------------------------------------------
    function aplicarDias(grupo, decisoes) {
        const alteracoes = [];
        const manter = grupo.motivoDuvida && decisoes[grupo.chave] !== "corrigir";
        if (manter) return alteracoes;

        for (const { evento, atual, esperado } of grupo.divergencias) {
            evento.campos[COL.DIA_INICIO] = String(esperado.inicio);
            evento.campos[COL.DIA_FIM] = String(esperado.fim);
            alteracoes.push({
                ...dadosEvento(evento.campos),
                de: `${atual.inicio} → ${atual.fim}`,
                para: `${esperado.inicio} → ${esperado.fim}`,
            });
        }
        return alteracoes;
    }

    function preencherProgramacao(eventos, programacoes) {
        const preenchidas = new Map();
        for (const { campos } of eventos) {
            const chave = chaveDataLinha(campos);
            if (campos[COL.PROGRAMACAO].trim() || !programacoes[chave]) continue;
            campos[COL.PROGRAMACAO] = programacoes[chave];
            preenchidas.set(chave, (preenchidas.get(chave) || 0) + 1);
        }
        return [...preenchidas].map(([chave, total]) => {
            const [data, linha] = chave.split("|");
            return { data, linha, total, codigo: programacoes[chave] };
        });
    }

    function renumerar(grupo) {
        let alteradas = 0;
        grupo.eventos.forEach((evento, i) => {
            const seq = String(i + 1);
            if (evento.campos[COL.SEQ] !== seq) {
                evento.campos[COL.SEQ] = seq;
                alteradas++;
            }
        });
        return alteradas;
    }

    // Campos informativos: o layout usa vírgula decimal e o Globus manda 0 veículos
    function preencherQuantidades(eventos) {
        const carrosPorLinha = new Map();
        for (const { campos } of eventos) {
            const chave = chaveDataLinha(campos);
            if (!carrosPorLinha.has(chave)) carrosPorLinha.set(chave, new Set());
            if (campos[COL.PREFIXO].trim()) carrosPorLinha.get(chave).add(campos[COL.PREFIXO]);
        }
        for (const { campos } of eventos) {
            campos[COL.QTD_VIAGENS] = campos[COL.QTD_VIAGENS].replace(".", ",");
            campos[COL.QTD_VEICULOS] = String(carrosPorLinha.get(chaveDataLinha(campos)).size);
        }
    }

    // ----------------------------------------------------------
    // Críticas (só avisam, não bloqueiam a exportação)
    // ----------------------------------------------------------
    function horarioIncoerente({ campos }, anterior) {
        const inicio = minutos(campos[COL.H_INICIO]);
        const fim = minutos(campos[COL.H_FIM]);
        const fimAnterior = anterior ? minutos(anterior.campos[COL.H_FIM]) : inicio;

        return (fim < inicio && !virouMeiaNoite(inicio, fim))
            || (inicio < fimAnterior && !virouMeiaNoite(fimAnterior, inicio));
    }

    function criticasPorTabela(grupos) {
        const criticas = [];

        for (const grupo of grupos) {
            const { data, linha, tabela, eventos } = grupo;
            const faixa = lista => {
                const inicio = formatarHora(lista[0].campos[COL.H_INICIO]);
                const fim = formatarHora(lista[lista.length - 1].campos[COL.H_FIM]);
                return `${lista.length} evento(s), ${inicio}–${fim}`;
            };

            const semCarro = eventos.filter(e => !e.campos[COL.PREFIXO].trim());
            if (semCarro.length) {
                criticas.push({ tipo: "Tabela sem carro", data, linha, tabela, detalhe: faixa(semCarro) });
            }

            const semCondutor = eventos.filter(e => !e.campos[COL.MATRICULA].trim());
            if (semCondutor.length) {
                criticas.push({ tipo: "Tabela sem condutor", data, linha, tabela, detalhe: faixa(semCondutor) });
            }

            const incoerentes = eventos.filter((e, i) => horarioIncoerente(e, eventos[i - 1]));
            if (incoerentes.length) {
                const seqs = incoerentes.map(e => {
                    const { seq, inicio, fim } = dadosEvento(e.campos);
                    return `Seq ${seq} (${inicio}–${fim})`;
                }).join(", ");
                criticas.push({ tipo: "Horário incoerente", data, linha, tabela, detalhe: `${seqs} (ajustar no ERP)` });
            }

            const semCodigo = eventos.filter(e => e.campos[COL.FLAG] === "0" && !e.campos[COL.CODIGO].trim());
            if (semCodigo.length) {
                const seqs = semCodigo.map(e => e.campos[COL.SEQ]).join(", ");
                criticas.push({
                    tipo: "Improdutivo sem código",
                    data, linha, tabela,
                    detalhe: `Seq ${seqs} (ajustar no ERP)`,
                    eventos: semCodigo.length,
                });
            }
        }
        return criticas;
    }

    function criticasDeViagens(eventos) {
        const porQuantidade = new Map();

        for (const { campos } of eventos) {
            const quantidade = campos[COL.QTD_VIAGENS];
            const data = campos[COL.DATA_ESCALA];
            const chave = `${data}|${quantidade}`;
            if (!porQuantidade.has(chave)) {
                porQuantidade.set(chave, { data, quantidade, linhas: new Set(), produtivos: 0 });
            }
            const item = porQuantidade.get(chave);
            item.linhas.add(campos[COL.LINHA]);
            if (campos[COL.FLAG] === "1") item.produtivos++;
        }

        const criticas = [];
        for (const item of porQuantidade.values()) {
            const { data, quantidade } = item;
            // Cada viagem da quantidade são 2 eventos (ida e volta). Linhas diferentes podem
            // ter a mesma quantidade, por isso o múltiplo limitado ao número de linhas.
            const multiplo = item.produtivos / (2 * Number(quantidade.replace(",", ".")));
            if (Number.isInteger(multiplo) && multiplo >= 1 && multiplo <= item.linhas.size) continue;

            criticas.push({
                tipo: "Viagens não conferem",
                data,
                linha: [...item.linhas].join(", "),
                tabela: "—",
                detalhe: `Informado ${quantidade}, encontrado ${item.produtivos / 2}`,
            });
        }
        return criticas;
    }

    function criticasDeSobreposicao(eventos) {
        const recursos = [
            { col: COL.PREFIXO, tipo: "Carro sobreposto" },
            { col: COL.MATRICULA, tipo: "Condutor sobreposto" },
        ];
        const criticas = [];

        for (const { col, tipo } of recursos) {
            const porRecurso = new Map();

            for (const { campos } of eventos) {
                const recurso = campos[col].trim();
                if (!recurso) continue;
                const chave = `${campos[COL.DATA_ESCALA]}|${recurso}`;
                if (!porRecurso.has(chave)) porRecurso.set(chave, []);
                porRecurso.get(chave).push({
                    campos,
                    inicio: (Number(campos[COL.DIA_INICIO]) - 1) * 1440 + minutos(campos[COL.H_INICIO]),
                    fim: (Number(campos[COL.DIA_FIM]) - 1) * 1440 + minutos(campos[COL.H_FIM]),
                });
            }

            for (const [chave, lista] of porRecurso) {
                const [data, recurso] = chave.split("|");
                lista.sort((a, b) => a.inicio - b.inicio || a.fim - b.fim);
                lista.slice(1).forEach((atual, i) => {
                    const anterior = lista[i];
                    if (atual.inicio >= anterior.fim) return;

                    const a = dadosEvento(anterior.campos);
                    const b = dadosEvento(atual.campos);
                    criticas.push({
                        tipo,
                        data,
                        linha: a.linha === b.linha ? a.linha : `${a.linha}, ${b.linha}`,
                        tabela: a.tabela === b.tabela ? a.tabela : `${a.tabela}, ${b.tabela}`,
                        detalhe: `${recurso}: ${a.inicio}–${a.fim} x ${b.inicio}–${b.fim}`,
                    });
                });
            }
        }
        return criticas;
    }

    // Trabalha sobre uma cópia: a análise original continua valendo
    // quando o usuário muda uma decisão na etapa de confirmação.
    function resolver(analise, decisoes = {}, programacoes = {}) {
        const grupos = analise.grupos.map(grupo => {
            const eventos = grupo.eventos.map(e => ({ numero: e.numero, campos: [...e.campos] }));
            const porNumero = new Map(eventos.map(e => [e.numero, e]));
            return {
                ...grupo,
                eventos,
                divergencias: grupo.divergencias.map(d => ({ ...d, evento: porNumero.get(d.evento.numero) })),
            };
        });

        const alteracoesDia = grupos.flatMap(g => aplicarDias(g, decisoes));

        const sequenciasAlteradas = grupos.reduce((total, g) => total + renumerar(g), 0);

        const eventos = grupos
            .flatMap(g => g.eventos)
            .sort((a, b) => a.numero - b.numero);

        const programacoesPreenchidas = preencherProgramacao(eventos, programacoes);
        preencherQuantidades(eventos);

        const montarArquivo = linhas => (
            linhas.map(campos => campos.join(";")).join(analise.eol) +
            (analise.terminaComQuebra ? analise.eol : "")
        );

        return {
            escala: montarArquivo(eventos.map(e => e.campos)),
            // Programação: mesmo arquivo, sem as colunas de DATA ESCALA em diante
            prog: montarArquivo(eventos.map(e => e.campos.slice(0, COL.DATA_ESCALA))),
            totalLinhas: eventos.length,
            alteracoesDia,
            programacoesPreenchidas,
            sequenciasAlteradas,
            criticas: [
                ...criticasPorTabela(grupos),
                ...criticasDeViagens(eventos),
                ...criticasDeSobreposicao(eventos),
            ].sort((a, b) => ORDEM_CRITICAS.indexOf(a.tipo) - ORDEM_CRITICAS.indexOf(b.tipo)),
        };
    }

    // Versão da tela: o detalhe completo das resumidas fica no log
    function resumirCriticas(criticas) {
        const resumo = criticas.filter(c => !CRITICAS_RESUMIDAS.has(c.tipo));

        for (const tipo of CRITICAS_RESUMIDAS) {
            const itens = criticas.filter(c => c.tipo === tipo);
            if (!itens.length) continue;

            const eventos = itens.reduce((total, c) => total + c.eventos, 0);
            resumo.push({
                tipo,
                data: "—",
                linha: "—",
                tabela: "—",
                detalhe: `${itens.length} tabela(s), ${eventos} evento(s). Detalhe no log`,
            });
        }
        return resumo;
    }

    return { analisar, resolver, resumirCriticas, dadosEvento, COL };
})();

if (typeof module !== "undefined") module.exports = GlobusEngine;
