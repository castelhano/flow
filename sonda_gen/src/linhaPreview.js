function linhaPreview(cod){
    let linha = linhas[cod];
    let size = linha.length;
    let cnsl = document.getElementById('cnsl');
    let btnGerarLinha = document.getElementById('btnGerarLinha');

    document.querySelectorAll('#linhas_container li').forEach(li => li.classList.remove('active'));
    const liAtivo = document.querySelector(`#linhas_container li[data-value="${cod}"]`);
    if (liAtivo) liAtivo.classList.add('active');

    cnsl.innerHTML = '';
    for(let i = 0; i < size; i++){
        let dir = linha[i][10] === 'I' ? 'IDA' : 'VOLTA';
        let nrow = `<p>
            <span style="color:var(--text-3);width:24px;display:inline-block;">${i+1}</span>
            <span style="color:var(--accent);min-width:40px;">${linha[i][4]}</span>
            <span style="min-width:52px;">${linha[i][11].slice(0,-2)+':'+linha[i][11].slice(-2)} → ${linha[i][12].slice(0,-2)+':'+linha[i][12].slice(-2)}</span>
            <span style="color:var(--text-3);min-width:44px;">${dir}</span>
            <span style="color:var(--text-3);">veic ${linha[i][22] || '—'}</span>
        </p>`;
        cnsl.innerHTML += nrow;
    }

    btnGerarLinha.innerHTML = `Gerar linha <b>${cod}</b>`;
    btnGerarLinha.dataset.linha = cod;
    btnGerarLinha.classList.remove('d-none');
}
