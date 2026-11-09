// ============================================================
// PaxCorte.js — Leitura da bilhetagem recortada no dia operacional
//
// Responsabilidade: ler um ou mais CSVs de bilhetagem (cada um pode
// ter vários dias e centenas de MB) em streaming e devolver somente
// as linhas que pertencem ao dia operacional informado (data do GPS).
//
// Vários arquivos: os exports vêm por período (ex: 10–19, 20–29). O
// primeiro dia de um período precisa da noite anterior, que está no
// arquivo anterior, e o último precisa da madrugada seguinte, que
// está no próximo. Carregar os dois resolve a virada sem inferência.
// Registros repetidos entre arquivos são descartados.
//
// Memória: os arquivos são lidos em pedaços; só as linhas da janela
// [D-1 20:00, D+1 horaCorte) são guardadas, e de cada linha só as
// colunas usadas pelo app (horário, empresa, linha, veículo, tipo,
// tarifa). Strings repetidas são compartilhadas. Carregar mais
// arquivos custa tempo de leitura, não memória.
//
// Regra de virada (APP_CONFIG.engine.virada): registro da madrugada
// (antes de horaCorte) é do dia anterior quando é continuação, sem
// pausa >= gapJornadaMin, de uma jornada do veículo iniciada antes
// da meia-noite. A partir de horaCorte vale a data do calendário.
//
// Depende de PapaParse e de _validarCSV (main.js).
// ============================================================

const PaxCorte = {

    // Janela de contexto antes da meia-noite de D (para saber se a
    // madrugada de D é continuação da noite de D-1)
    JANELA_ANTES_MIN: 240,

    // Coluna do cartão — usada só para descartar repetidos entre arquivos
    COLUNA_CARTAO: 9,   // "J"

    // Dia considerado incompleto se o primeiro registro vier depois de
    // INICIO_DIA_MAX ou o último antes de FIM_DIA_MIN (minutos do dia)
    INICIO_DIA_MAX: 6 * 60,
    FIM_DIA_MIN:    22 * 60,

    // ----------------------------------------------------------
    // Valida o arquivo lendo só as primeiras linhas.
    // Lança Error se o layout não for de bilhetagem.
    // ----------------------------------------------------------
    validar(file, encoding = "ISO-8859-1") {
        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: false, skipEmptyLines: true, encoding, preview: 3,
                complete: (res) => {
                    try {
                        _validarCSV(res.data.slice(1), "pax");
                        resolve();
                    } catch (e) { reject(e); }
                },
                error: (err) => reject(new Error(`Erro ao ler CSV: ${err.message}`))
            });
        });
    },


    // ----------------------------------------------------------
    // Lê um ou mais arquivos e devolve { linhas, resumo }
    //   files        — File ou array de File (períodos; podem se
    //                  sobrepor, repetidos são descartados)
    //   dataOperacao — "DD/MM/AAAA" (coluna Data do GPS)
    //   onProgresso  — callback(fração 0..1), opcional
    //   linhas       — arrays no layout original (índices de coluna
    //                  preservados), prontos para o DataNormalizer
    // ----------------------------------------------------------
    async carregar(files, dataOperacao, onProgresso = null, encoding = "ISO-8859-1") {
        files = Array.isArray(files) ? files : [files];
        const dia0 = PaxCorte.diaIndex(dataOperacao);
        if (dia0 === null) throw new Error(`Data de operação do GPS inválida: "${dataOperacao}"`);

        const cfg       = APP_CONFIG.engine.virada;
        const corteMin  = cfg.horaCorte * 60;
        const gap       = cfg.gapJornadaMin;
        const iniJanela = -PaxCorte.JANELA_ANTES_MIN;
        const fimJanela = 1440 + corteMin;

        const C = PaxCorte._colunas();
        const intern = new Map();
        const str = (s) => {
            s = s ?? "";
            let v = intern.get(s);
            if (v === undefined) {
                // Cópia "plana": evita que a string retenha o pedaço inteiro do arquivo
                v = PaxCorte._plano(s);
                intern.set(v, v);
            }
            return v;
        };

        // Arquivos podem se sobrepor. Chave = horário + carro + cartão, mas a mesma
        // chave pode se repetir legitimamente (ex: botoeira, várias liberações no
        // mesmo segundo). Por isso conta por arquivo: na sobreposição fica o maior
        // número de ocorrências visto em um mesmo arquivo.
        const aceitos = files.length > 1 ? new Map() : null;   // chave → ocorrências aceitas
        const est = {
            registros: [],                // { t, v, row }
            total: 0, semData: 0, duplicados: 0,
            temNoiteAnterior: false,      // há registro em D-1 antes de 00:00 - gap (cobre a pausa de jornada)
            temMadrugadaSeguinte: false,  // há registro em D+1 a partir da hora de corte
            minDia: null, maxDia: null    // primeiro/último registro no calendário de D
        };

        const tamanhoTotal = files.reduce((s, f) => s + (f.size || 0), 0) || 1;
        let lidoAntes = 0;

        for (const file of files) {
            const noArquivo = aceitos ? new Map() : null;     // chave → ocorrências neste arquivo
            await new Promise((resolve, reject) => {
                let cabecalho = true;
                Papa.parse(file, {
                    header: false, skipEmptyLines: true, encoding,
                    chunkSize: 1024 * 1024 * 4,
                    chunk: (res, parser) => {
                        const data = res.data;
                        let i = 0;
                        if (cabecalho) {
                            cabecalho = false;
                            i = 1;
                            try { _validarCSV(data.slice(1, 2), "pax"); }
                            catch (e) { parser.abort(); return reject(new Error(`${file.name}: ${e.message}`)); }
                        }
                        for (; i < data.length; i++) {
                            const r = data[i];
                            est.total++;
                            const t = PaxCorte._minutosRelativos(r[C.horario], dia0);
                            if (t === null) { est.semData++; continue; }
                            if (t <= -gap)      est.temNoiteAnterior = true;
                            if (t >= fimJanela) est.temMadrugadaSeguinte = true;
                            if (t >= 0 && t < 1440) {
                                if (est.minDia === null || t < est.minDia) est.minDia = t;
                                if (est.maxDia === null || t > est.maxDia) est.maxDia = t;
                            }
                            if (t < iniJanela || t >= fimJanela) continue;

                            if (aceitos) {
                                const k = `${r[C.horario]}|${r[C.veiculo]}|${r[PaxCorte.COLUNA_CARTAO]}`;
                                const n = (noArquivo.get(k) || 0) + 1;
                                noArquivo.set(k, n);
                                if (n <= (aceitos.get(k) || 0)) { est.duplicados++; continue; }
                                aceitos.set(k, n);
                            }

                            const row = [];
                            row[C.horario] = PaxCorte._plano(r[C.horario]);
                            row[C.empresa] = str(r[C.empresa]);
                            row[C.linha]   = str(r[C.linha]);
                            row[C.veiculo] = str(r[C.veiculo]);
                            row[C.tipo]    = str(r[C.tipo]);
                            row[C.tarifa]  = str(r[C.tarifa]);
                            est.registros.push({ t, v: row[C.veiculo], row });
                        }
                        if (onProgresso && res.meta) {
                            onProgresso(Math.min((lidoAntes + res.meta.cursor) / tamanhoTotal, 1));
                        }
                    },
                    complete: resolve,
                    error: (err) => reject(new Error(`${file.name}: erro ao ler CSV: ${err.message}`))
                });
            });
            lidoAntes += file.size || 0;
        }

        return PaxCorte._recortar(est, { dia0, corteMin, gap });
    },


    // ----------------------------------------------------------
    // Aplica a regra de jornada sobre os registros da janela
    // ----------------------------------------------------------
    _recortar(est, { dia0, corteMin, gap }) {
        // Agrupa por veículo e ordena por horário (não depende da ordem dos arquivos)
        const porVeiculo = new Map();
        for (const r of est.registros) {
            let l = porVeiculo.get(r.v);
            if (!l) porVeiculo.set(r.v, l = []);
            l.push(r);
        }

        const linhas = [];
        let daNoiteAnterior = 0;          // madrugada de D descartada (é de D-1)
        let doDiaSeguinte   = 0;          // madrugada de D+1 incluída (é de D)
        let madrugadaSemConferencia = 0;  // madrugada de D mantida sem a noite anterior para comparar

        for (const lista of porVeiculo.values()) {
            lista.sort((a, b) => a.t - b.t);

            let inicioJornada = null, anterior = null;
            for (const r of lista) {
                if (anterior === null || r.t - anterior >= gap) inicioJornada = r.t;
                anterior = r.t;

                const diaCal    = Math.floor(r.t / 1440);    // -1, 0 ou 1
                const hora      = r.t - diaCal * 1440;       // minuto do dia no calendário
                const meiaNoite = diaCal * 1440;
                // Continuação da noite anterior: madrugada + jornada iniciada antes da meia-noite
                const continuacao = hora < corteMin && inicioJornada < meiaNoite;
                const diaRef = continuacao ? diaCal - 1 : diaCal;

                if (diaRef !== 0) {
                    if (diaCal === 0) daNoiteAnterior++;
                    continue;
                }
                if (diaCal === 1) doDiaSeguinte++;
                if (diaCal === 0 && hora < corteMin && !est.temNoiteAnterior) madrugadaSemConferencia++;
                linhas.push({ t: r.t, row: r.row });
            }
        }

        linhas.sort((a, b) => a.t - b.t);

        // Cobertura do próprio dia — alerta (dados do dia faltando)
        const dia   = (k) => PaxCorte._data(dia0 + k);
        const hhmm  = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
        const corte = hhmm(corteMin);
        const alertas = [];
        if (linhas.length === 0) {
            alertas.push(`Nenhum registro da bilhetagem pertence a ${dia(0)} (dia do GPS). Verifique se os arquivos são do mesmo período.`);
        } else if (est.minDia > PaxCorte.INICIO_DIA_MAX || est.maxDia < PaxCorte.FIM_DIA_MIN) {
            alertas.push(
                `A bilhetagem de ${dia(0)} está incompleta: os arquivos cobrem só de ${hhmm(est.minDia)} a ${hhmm(est.maxDia)}. ` +
                `Carregue o arquivo que contém o dia inteiro.`
            );
        }

        // Virada do dia — avisos opcionais (arquivo vizinho melhora, mas não é obrigatório)
        const avisos = [];
        if (linhas.length > 0) {
            if (!est.temNoiteAnterior && madrugadaSemConferencia > 0) {
                avisos.push(
                    `Sem a noite de ${dia(-1)}: os ${madrugadaSemConferencia} registros entre 00:00 e ${corte} de ${dia(0)} ` +
                    `ficaram no dia sem conferir se são fim de jornada da noite anterior.\n` +
                    `   Para separar, carregue também o arquivo que contém a noite de ${dia(-1)}.`
                );
            }
            if (!est.temMadrugadaSeguinte) {
                avisos.push(
                    `Sem a madrugada de ${dia(1)}: jornadas de ${dia(0)} que passam da meia-noite ` +
                    `ficaram sem os passageiros entre 00:00 e ${corte} de ${dia(1)}.\n` +
                    `   Para completar, carregue também o arquivo que contém ${dia(1)}.`
                );
            }
        }
        if (est.semData > 0) alertas.push(`${est.semData} registro(s) sem data/horário reconhecível foram ignorados.`);

        return {
            linhas: linhas.map(l => l.row),
            resumo: {
                totalArquivos: est.total,
                noDia:         linhas.length,
                daNoiteAnterior,
                doDiaSeguinte,
                madrugadaSemConferencia,
                duplicados:    est.duplicados,
                temNoiteAnterior:     est.temNoiteAnterior,
                temMadrugadaSeguinte: est.temMadrugadaSeguinte,
                alertas,
                avisos
            }
        };
    },


    // ----------------------------------------------------------
    // Auxiliares
    // ----------------------------------------------------------

    _colunas() {
        const c = APP_CONFIG.fontes.bilhetagem.colunas;
        const idx = (def) => DataNormalizer._letraParaIndice(typeof def === "object" ? def.coluna : def);
        return {
            horario: idx(c.horario), empresa: idx(c.empresa), linha: idx(c.linha),
            veiculo: idx(c.veiculo), tipo: idx(c.tipo), tarifa: idx(c.tarifa)
        };
    },

    // Índice do dia (dias desde 1970) a partir de "DD/MM/AAAA..." ou "AAAA-MM-DD..."
    diaIndex(str) {
        const s = String(str || "");
        let m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000;
        m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000;
        return null;
    },

    // Minutos (com fração de segundos) desde a meia-noite do dia dia0
    _minutosRelativos(horario, dia0) {
        const s = String(horario || "");
        const dia = PaxCorte.diaIndex(s);
        if (dia === null) return null;
        const h = s.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
        if (!h) return null;
        return (dia - dia0) * 1440 + (+h[1]) * 60 + (+h[2]) + (h[3] ? +h[3] / 60 : 0);
    },

    // Recria a string como cópia nova. Strings extraídas pelo parser podem
    // ser "fatias" que mantêm vivo o pedaço inteiro (4 MB) do arquivo.
    _plano(s) {
        return String(s ?? "").split("").join("");
    },

    // Índice do dia → "DD/MM"
    _data(diaIdx) {
        const d = new Date(diaIdx * 86400000);
        return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
};
