// ============================================================
// OmissoesPdf.js — Relatório das omissões do dia, em PDF (para os fiscais)
//
// Lista as viagens não realizadas no BI da Cittati (viagemRealizada
// "não"), de uma empresa num dia, agrupadas por linha e ordenadas pelo
// horário previsto. Sem os detalhes de GPS (parcial, ida quebrada...):
// só a omissão e o motivo lançado.
//
// As com motivo #01–#04 (settings → fontes.cittati.motivosRealizada)
// rodaram, mas com problema no sistema: vão ao final, numa seção à parte,
// só como informativo.
//
// Usa jsPDF + autoTable (vendor/). A4 paisagem.
// ============================================================

const OmissoesPdf = {

    COLUNAS: ["Linha", "Sentido", "Tab", "Previsto", "Carro", "Condutor", "Motivo"],

    // viagens: linhas de Cittati.paraGps (com viagem.cittati)
    // meta: { empresa, data (AAAA-MM-DD), biAtualizadoEm, total }
    gerar(viagens, meta) {
        const omissoes = viagens.filter(v => !v.cittati.realizadaBI).sort((a, b) =>
            a.linha_base.localeCompare(b.linha_base, "pt-BR", { numeric: true })
            || (a.cittati.mPrevInicio ?? 0) - (b.cittati.mPrevInicio ?? 0));
        const principais  = omissoes.filter(v => !v.cittati.motivoRealizada);
        const informativo = omissoes.filter(v => v.cittati.motivoRealizada);

        const { jsPDF } = window.jspdf;
        const doc   = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        const larg  = doc.internal.pageSize.getWidth();
        const alt   = doc.internal.pageSize.getHeight();
        const marg  = 12;
        const diaBR = Cittati.isoParaBR(meta.data);
        const titulo = `Omissões do dia ${diaBR} - ${meta.empresa}`;

        // --- cabeçalho da primeira página ---
        doc.setFont("helvetica", "bold").setFontSize(16);
        doc.text(titulo, marg, marg + 4);
        doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(90);
        doc.text([
            `${principais.length} omissão(ões) · ${informativo.length} com motivo #01-#04 (informativo, ao final) · ` +
            `${meta.total} viagens programadas no dia`,
            `BI da Cittati atualizado em ${this._fmt(meta.biAtualizadoEm)} · gerado em ${this._fmt(new Date().toISOString())}`
        ], marg, marg + 11);
        doc.setTextColor(0);

        let y = marg + 22;
        if (principais.length) {
            this._tabela(doc, principais, y, marg);
            y = doc.lastAutoTable.finalY + 10;
        } else {
            doc.setFontSize(11).text("Nenhuma omissão no dia (fora as do informativo abaixo).", marg, y + 4);
            y += 12;
        }

        if (informativo.length) {
            if (y > alt - 40) { doc.addPage(); y = marg + 4; }
            doc.setFont("helvetica", "bold").setFontSize(13);
            doc.text("Informativo - viagens com motivo #01 a #04", marg, y);
            doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(90);
            doc.text("Viagens feitas, mas com problema no sistema (GPS inoperante ou com falha, 50% do trajeto, erro do sistema). " +
                     "Só para conhecimento.", marg, y + 5.5, { maxWidth: larg - 2 * marg });
            doc.setTextColor(0);
            this._tabela(doc, informativo, y + 9, marg, true);
        }

        // --- rodapé em todas as páginas ---
        const n = doc.getNumberOfPages();
        for (let i = 1; i <= n; i++) {
            doc.setPage(i);
            doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(120);
            doc.text(titulo, marg, alt - 6);
            doc.text(`página ${i} de ${n}`, larg - marg, alt - 6, { align: "right" });
        }

        const emp = String(meta.empresa).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "_");
        doc.save(`omissoes_${emp}_${meta.data}.pdf`);
        return { principais: principais.length, informativo: informativo.length };
    },

    // Uma tabela com uma linha de título por linha de ônibus
    _tabela(doc, viagens, y, marg, informativo = false) {
        const corGrupo = informativo ? [225, 225, 225] : [215, 228, 245];
        const corhead  = informativo ? [110, 110, 110] : [40, 70, 120];
        const body = [];
        let linhaAtual = null;
        for (const v of viagens) {
            if (v.linha_base !== linhaAtual) {
                linhaAtual = v.linha_base;
                const n = viagens.filter(x => x.linha_base === linhaAtual).length;
                body.push([{
                    content: `Linha ${linhaAtual}  ·  ${n} viagem(ns)`, colSpan: this.COLUNAS.length,
                    styles: { fillColor: corGrupo, fontStyle: "bold", fontSize: 11 }
                }]);
            }
            const c = v.cittati;
            body.push([
                v.linha_base,
                Revisao._sentido(v.sentido, c.rota),
                v.tabela || "-",
                `${Cittati._hora(c.prevInicio) || "?"} - ${Cittati._hora(c.prevFim) || "?"}`,
                v.veiculo || "-",
                v.motorista || "-",
                c.motivo ? c.motivo : { content: "SEM MOTIVO", styles: { fontStyle: "bold", textColor: [180, 30, 30] } }
            ]);
        }

        doc.autoTable({
            startY: y,
            margin: { left: marg, right: marg, top: marg + 4, bottom: 14 },
            head: [this.COLUNAS],
            body,
            theme: "grid",
            styles: { font: "helvetica", fontSize: 10.5, cellPadding: 1.8, valign: "middle", lineColor: [190, 190, 190], lineWidth: 0.2 },
            headStyles: { fillColor: corhead, textColor: 255, fontStyle: "bold", fontSize: 10.5 },
            columnStyles: {
                0: { cellWidth: 20, fontStyle: "bold" },
                1: { cellWidth: 52 },
                2: { cellWidth: 16, halign: "center" },
                3: { cellWidth: 30, halign: "center" },
                4: { cellWidth: 20, halign: "center" },
                5: { cellWidth: 26, halign: "center" },
                6: { cellWidth: "auto" }
            },
            showHead: "everyPage",
            rowPageBreak: "avoid"
        });
    },

    _fmt(s) {
        return s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-";
    }
};
