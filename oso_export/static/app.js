function appAlert(tipo, mensagem, autoDismiss = true) {
    try { document.querySelector('[data-type="appAlert"]').remove(); } catch(e) {}
    const el = document.createElement('div');
    el.setAttribute('data-type', 'appAlert');
    el.className = 'app-alert app-alert-' + tipo;
    const msg = document.createElement('span');
    msg.className = 'app-alert-msg';
    msg.innerHTML = mensagem;
    const close = document.createElement('button');
    close.className = 'app-alert-close';
    close.textContent = '×';
    close.onclick = () => el.remove();
    el.appendChild(msg);
    el.appendChild(close);
    document.body.appendChild(el);
    if (autoDismiss) { setTimeout(() => el.remove(), 5000); }
}
