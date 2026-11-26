#!/usr/bin/env bash
# ============================================================
# Instala ou atualiza o flow-api nesta máquina (rafaelplan).
#   sudo bash flow_api/install.sh
#
# Pode rodar de novo a cada mudança no server.py: só copia o código,
# reinicia o serviço e recarrega o nginx. O login do BI e os arquivos
# do nyx no nginx nunca são sobrescritos.
# Especificação: docs/cittati_bi_servico.md
# ============================================================
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Rode com sudo: sudo bash $0" >&2; exit 1; }

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NYX_ENV=/srv/nyx/apps/api/.env
ENV=/etc/flow-api/.env
NGX=/etc/nginx
NGX_D=$NGX/rafaelplan.d
# sites-available/nyx como estava quando a migração foi escrita
NYX_SHA=a91cd075a67b4e32aa73379cdf04e9ac8b71f0d255af357a2fb01588778078ff

passo() { echo; echo "== $*"; }

# ---------- 1. usuário de sistema ----------
passo "usuário flow-api"
if id flow-api &>/dev/null; then
    echo "já existe"
else
    useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin flow-api
    echo "criado"
fi

# ---------- 2. código ----------
passo "código em /opt/flow-api"
install -d -m 755 -o root -g root /opt/flow-api
install -m 644 -o root -g root "$DIR/server.py" /opt/flow-api/server.py
python3 -m py_compile /opt/flow-api/server.py
rm -rf /opt/flow-api/__pycache__
echo "ok"

# ---------- 3. login do BI ----------
passo "login do BI em $ENV"
install -d -m 700 -o flow-api -g flow-api /etc/flow-api
if [[ -f $ENV ]]; then
    echo "já existe, mantido"
else
    (
        umask 077
        if grep -qE '^CITTATI_BI_USER=.' "$NYX_ENV" 2>/dev/null && grep -qE '^CITTATI_BI_PASSWORD=.' "$NYX_ENV"; then
            grep -E '^CITTATI_BI_(USER|PASSWORD)=' "$NYX_ENV" > "$ENV"
            echo "copiado de $NYX_ENV"
        else
            printf 'CITTATI_BI_USER=\nCITTATI_BI_PASSWORD=\n' > "$ENV"
            echo "ATENÇÃO: preencha $ENV e rode: sudo systemctl restart flow-api"
        fi
    )
fi
chown flow-api:flow-api "$ENV"
chmod 600 "$ENV"

# ---------- 4. serviço systemd ----------
passo "serviço flow-api.service"
install -m 644 -o root -g root "$DIR/flow-api.service" /etc/systemd/system/flow-api.service
systemctl daemon-reload
systemctl enable flow-api.service
systemctl restart flow-api.service
echo "ok"

# ---------- 5. nginx ----------
passo "nginx"
install -d -m 755 "$NGX_D"
install -m 644 "$DIR/nginx/flow-api.server.conf" "$NGX_D/flow-api.server.conf"

migrou=0
if [[ -L $NGX/sites-enabled/nyx ]]; then
    # Migração única: o site do nyx vira o site da máquina + rafaelplan.d/nyx.*
    atual=$(sha256sum "$NGX/sites-available/nyx" | cut -d' ' -f1)
    if [[ $atual != "$NYX_SHA" ]]; then
        echo "sites-available/nyx mudou desde que a migração foi escrita; nada foi feito no nginx." >&2
        echo "Confira as diferenças com flow_api/nginx/ antes de seguir." >&2
        exit 1
    fi
    for f in nyx.http.conf nyx.server.conf; do
        [[ -f $NGX_D/$f ]] || install -m 644 "$DIR/nginx/$f" "$NGX_D/$f"
    done
    [[ -f $NGX/sites-available/rafaelplan ]] || install -m 644 "$DIR/nginx/rafaelplan" "$NGX/sites-available/rafaelplan"
    ln -sfn ../sites-available/rafaelplan "$NGX/sites-enabled/rafaelplan"
    rm "$NGX/sites-enabled/nyx"      # sites-available/nyx fica, como cópia do original
    migrou=1
    echo "site do nyx migrado para sites-available/rafaelplan + rafaelplan.d/"
fi

if ! nginx -t; then
    echo "nginx -t falhou." >&2
    if [[ $migrou == 1 ]]; then
        rm -f "$NGX/sites-enabled/rafaelplan"
        ln -s ../sites-available/nyx "$NGX/sites-enabled/nyx"
        echo "Site do nyx restaurado como estava." >&2
    fi
    rm -f "$NGX_D/flow-api.server.conf"
    exit 1
fi
systemctl reload nginx
echo "recarregado"

# ---------- 6. conferência ----------
passo "conferência"
CA=/etc/nyx-tls/nyx-local-ca.crt
URL=https://rafaelplan.local
R=(--resolve rafaelplan.local:443:127.0.0.1 --cacert "$CA" -s -m 30)
for _ in $(seq 1 20); do
    curl "${R[@]}" -o /dev/null "$URL/flow-api/cittati/saude" && break
    sleep 0.5
done
echo "saude: $(curl "${R[@]}" "$URL/flow-api/cittati/saude")"
echo "nyx /: $(curl "${R[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "$URL/")"
echo
echo "Pronto. Log: journalctl -u flow-api -f"
