# Flow — Guideline Visual

Design system extraído do app **Flow** (dashboard + ferramentas internas). Serve como base para replicar a mesma identidade visual em novos projetos: dark mode técnico, monoespaçado, denso, sem ornamentos.

Referência viva: [static/css/app.css](static/css/app.css) e [dashboard.html](dashboard.html).

---

## 1. Princípios

- **Dark-first, sem tema claro.** Fundo quase preto, texto claro, nunca branco puro.
- **Utilitário, não decorativo.** É ferramenta interna — prioriza densidade de informação e escaneabilidade sobre estética expressiva.
- **Monoespaçado para dados e labels, sans para leitura.** `JetBrains Mono` marca tudo que é rótulo, número, código ou ação. `DM Sans` é usado só em texto corrido (descrições).
- **Hierarquia por tamanho + letter-spacing, não por cor.** Títulos de seção, badges e labels usam caixa alta + tracking largo (`.06em`–`.1em`) em vez de peso pesado.
- **Cor é sinal, não decoração.** Accent azul = ação/foco. Verde/âmbar/vermelho só aparecem para status (sucesso/atenção/erro). O resto da UI é neutro em tons de cinza-azulado.
- **Bordas finas de 1px, sem sombras.** Profundidade vem de degradês de `--bg` a `--bg-4`, não de `box-shadow`.

---

## 2. Fontes

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
```

```css
--mono: 'JetBrains Mono', monospace;  /* labels, títulos, tabelas, botões, badges */
--sans: 'DM Sans', sans-serif;        /* parágrafos e descrições */
```

Ícones: [Lucide](https://lucide.dev) via CDN, renderizados com `lucide.createIcons()`.

```html
<script src="https://unpkg.com/lucide@latest"></script>
...
<i data-lucide="layout-dashboard"></i>
<script>lucide.createIcons();</script>
```

---

## 3. Tokens de cor

```css
:root {
    --bg:          #0d0f11;   /* fundo da página */
    --bg-2:        #131619;   /* topbar, cards */
    --bg-3:        #1a1e22;   /* hover de card, inputs, linhas de tabela */
    --bg-4:        #20262c;   /* tag/badge de fundo, ícones neutros */
    --border:      #2a3038;
    --border-hi:   #3d4a57;   /* borda em hover/focus */

    --text:        #e2e8f0;   /* texto principal */
    --text-2:      #8fa0b0;   /* texto secundário */
    --text-3:      #4e6070;   /* texto terciário / labels */

    --accent:      #3b82f6;
    --accent-dim:  #1d4ed8;
    --accent-glow: rgba(59,130,246,.15);

    --success:     #10b981;
    --success-dim: rgba(16,185,129,.12);
    --warning:     #f59e0b;
    --warning-dim: rgba(245,158,11,.12);
    --danger:      #ef4444;
    --danger-dim:  rgba(239,68,68,.12);
    --muted-dim:   rgba(255,255,255,.04);

    --radius:    6px;
    --radius-lg: 10px;
}
```

Regra prática: qualquer superfície "elevada" usa `--bg-2`/`--bg-3`/`--bg-4` + `border: 1px solid var(--border)`. Nunca usar preto puro (`#000`) ou branco puro (`#fff`) exceto em ícones sobre fundo colorido.

### Paleta de acento por card/ícone (dashboard e afins)

Usada para diferenciar categorias de itens em grids de cards (ex.: ícones de projeto):

```css
.ic-blue   { background: #1d4ed8; }
.ic-violet { background: #7c3aed; }
.ic-teal   { background: #0d9488; }
.ic-amber  { background: #b45309; }
.ic-rose   { background: #be123c; }
```

---

## 4. Layout base

```css
* , *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: var(--sans);
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    line-height: 1.6;
}

#app {
    max-width: 1280px;
    margin: 0 auto;
    padding: 28px 24px 80px;
    display: flex;
    flex-direction: column;
    gap: 24px;
}
```

Todo projeto tem **um único container** `#app` com `max-width: 1280px` centralizado. Seções dentro dele são empilhadas com `gap: 24px`, nunca margin manual entre irmãos.

Scrollbar customizada (fina, discreta):

```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg-2); }
::-webkit-scrollbar-thumb { background: var(--border-hi); border-radius: 3px; }
```

---

## 5. Topbar

Barra fixa no topo de toda página (ferramenta ou dashboard). Sempre `sticky`, `height: 52px`, com logo à esquerda e ações/status à direita.

```css
#topbar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--bg-2);
    border-bottom: 1px solid var(--border);
    padding: 0 24px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    backdrop-filter: blur(8px);
}

.logo {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: .08em;
    display: flex;
    align-items: center;
    gap: 10px;
}

.logo-icon {
    width: 28px; height: 28px;
    background: var(--accent);
    border-radius: 5px;
    display: flex; align-items: center; justify-content: center;
}
.logo-icon svg { width: 14px; height: 14px; color: white; }

.logo-sub { color: var(--accent); font-weight: 400; } /* sufixo do nome do app */
```

```html
<header id="topbar">
    <div class="logo">
        <div class="logo-icon"><i data-lucide="layout-dashboard"></i></div>
        FLOW <span class="logo-sub">DASHBOARD</span>
    </div>
</header>
```

Padrão de nome: `NOME-CURTO-MAIUSCULO <span class="logo-sub">SUFIXO</span>`. Em ferramentas internas, o topbar-left costuma incluir um botão `btn btn-ghost` de "voltar" para o dashboard (`← Dashboard`).

---

## 6. Tipografia utilitária

| Elemento | Fonte | Tamanho | Peso | Tracking | Uso |
|---|---|---|---|---|---|
| Título de página | mono | 22px | 700 | .08em | `.dash-title` |
| Subtítulo de página | mono | 11px | 400 | .06em | `.dash-sub`, cor `--text-3` |
| Label de seção (etapa) | mono | 11px | 500 | .08em, uppercase | `.etapa-title`, cor `--text-2` |
| Nome de card | mono | 13px | 700 | .06em | `.card-name` |
| Descrição | sans | 12px | 400 | normal | `.card-desc`, cor `--text-2`, `line-height:1.6` |
| Label de campo/tabela | mono | 10px | 700 | .06–.1em, uppercase | headers de tabela, `.filter-group label` |
| Valor numérico grande | mono | 22px | 700 | normal | `.stat-value` |

Regra geral: **tudo em mono é curto e em maiúsculas com tracking**; texto corrido normal (frases, descrições) sempre em `--sans`, nunca uppercase.

---

## 7. Componente: seção "Etapa" (separador de fluxo)

Usado para dividir um processo em passos numerados dentro de uma ferramenta.

```css
.etapa-label { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }

.etapa-num {
    font-family: var(--mono);
    font-size: 10px; font-weight: 700; letter-spacing: .1em;
    color: var(--accent);
    background: var(--accent-glow);
    border: 1px solid rgba(59,130,246,.3);
    border-radius: 4px;
    padding: 2px 8px;
}

.etapa-title {
    font-family: var(--mono);
    font-size: 11px; font-weight: 500; letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--text-2);
}

.etapa-sep { flex: 1; height: 1px; background: var(--border); }
```

```html
<div class="etapa-label">
    <span class="etapa-num">ETAPA 01</span>
    <span class="etapa-title">Importação de dados</span>
    <div class="etapa-sep"></div>
    <!-- badge opcional à direita, ex: <span class="badge badge-warning">3 pendentes</span> -->
</div>
```

---

## 8. Componente: card base

```css
.card {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px;
}
```

Todo bloco de conteúdo agrupado (tabela, formulário, resumo) fica dentro de um `.card`, exceto grids de stat/cards especializados que já têm seu próprio fundo.

---

## 9. Componente: botões

```css
.btn {
    display: inline-flex; align-items: center; gap: 7px;
    font-family: var(--mono);
    font-size: 11px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase;
    padding: 9px 18px;
    border-radius: var(--radius);
    border: none;
    cursor: pointer;
    transition: opacity .15s, transform .1s;
    text-decoration: none;
}
.btn:hover  { opacity: .85; }
.btn:active { transform: scale(.98); }
.btn svg    { width: 14px; height: 14px; }

.btn-primary { background: var(--accent);  color: white; }
.btn-success { background: var(--success); color: white; }
.btn-ghost   { background: var(--bg-3); color: var(--text-2); border: 1px solid var(--border-hi); }
.btn-danger  { background: var(--danger);  color: white; }
```

```html
<button class="btn btn-primary"><i data-lucide="play"></i> Processar</button>
<a href="../dashboard.html" class="btn btn-ghost"><i data-lucide="arrow-left"></i> Dashboard</a>
```

Sempre com ícone Lucide + texto curto em caixa alta. `btn-ghost` é o botão neutro/secundário padrão (usado até em links `<a>`, inclusive "desabilitados" com `pointer-events:none` em cards não-clicáveis).

---

## 10. Componente: badge

```css
.badge { font-family: var(--mono); font-size: 10px; padding: 2px 8px; border-radius: 3px; font-weight: 700; }
.badge-warning { background: var(--warning-dim); color: var(--warning); }
.badge-success { background: var(--success-dim); color: var(--success); }
.badge-accent  { background: var(--accent-glow); color: var(--accent); }
```

Padrão de cor "dim background + cor sólida no texto" se repete em vários componentes (badge, stat-card border, op-icon) — é a assinatura visual do sistema para status.

---

## 11. Componente: tag pequena (card do dashboard)

```css
.card-tag {
    font-family: var(--mono);
    font-size: 9px; font-weight: 700; letter-spacing: .1em;
    color: var(--text-3);
    background: var(--bg-4);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 2px 7px;
    text-transform: uppercase;
}
```

---

## 12. Componente: tabelas

```css
.table-wrap {
    overflow-x: auto; overflow-y: auto; max-height: 500px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
}

table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }

thead th {
    position: sticky; top: 0; z-index: 1;
    font-family: var(--mono);
    font-size: 10px; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase;
    background-color: var(--bg-2);
    box-shadow: inset 0 -1px 0 var(--border-hi);
    color: var(--text-3);
    padding: 10px 14px;
    white-space: nowrap;
}

tbody tr { border-bottom: 1px solid var(--border); transition: background .1s; }
tbody tr:hover { background: var(--muted-dim); }
tbody td { padding: 9px 14px; color: var(--text-2); font-family: var(--mono); font-size: 11px; white-space: nowrap; }

tbody td.td-main { color: var(--text); font-weight: 500; } /* coluna de destaque */
```

Barra de "confiança"/progresso inline em célula:

```css
.conf-bar { display: flex; align-items: center; gap: 6px; }
.conf-track { width: 52px; height: 4px; background: var(--border-hi); border-radius: 2px; overflow: hidden; }
.conf-fill { height: 100%; border-radius: 2px; transition: width .3s; } /* background inline conforme % */
```

Todo conteúdo de tabela é `mono`, sempre pequeno (11-12px), sempre `white-space: nowrap` — tabelas são densas por design, com scroll horizontal quando necessário.

---

## 13. Componente: filtros / campos de formulário

```css
.filter-group { display: flex; flex-direction: column; gap: 4px; }

.filter-group label {
    font-family: var(--mono);
    font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
    color: var(--text-3);
}

.filter-group input, .filter-group select {
    background: var(--bg-3);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius);
    color: var(--text);
    font-family: var(--mono);
    font-size: 11px;
    padding: 7px 10px;
    height: 32px;
    outline: none;
    transition: border-color .15s;
}
.filter-group input:focus, .filter-group select:focus { border-color: var(--accent); }
```

Grupos de filtro ficam lado a lado em `display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end;` (ver `.excecoes-toolbar`), com botões `btn-ghost` alinhados no fim (`align-self:flex-end`) para casar a altura de 32px.

Checkbox estilizado (sem lib):

```css
input[type="checkbox"] {
    appearance: none;
    width: 14px; height: 14px;
    border: 1px solid var(--border-hi);
    border-radius: 3px;
    background: var(--bg-3);
    cursor: pointer;
    position: relative;
}
input[type="checkbox"]:checked { background: var(--accent); border-color: var(--accent); }
input[type="checkbox"]:checked::after {
    content: '';
    position: absolute; left: 3px; top: 1px;
    width: 6px; height: 8px;
    border: 1.5px solid white; border-top: none; border-left: none;
    transform: rotate(40deg) scaleX(.9);
}
```

---

## 14. Componente: stat card (KPIs)

Usado em telas de resumo/dashboard interno de uma ferramenta (não confundir com os cards de projeto do dashboard geral — ver seção 17).

```css
.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); /* ou repeat(N, 1fr) fixo */
    gap: 10px;
}

.stat-card {
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    position: relative;
    overflow: hidden;
}

.stat-card::before {
    content: '';
    position: absolute; left: 0; top: 0; bottom: 0;
    width: 3px;
    background: var(--text-3); /* cor neutra por padrão */
    border-radius: 3px 0 0 3px;
}
.stat-card.c-blue::before   { background: var(--accent); }
.stat-card.c-green::before  { background: var(--success); }
.stat-card.c-yellow::before { background: var(--warning); }
.stat-card.c-red::before    { background: var(--danger); }

.stat-label { font-family: var(--mono); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-3); margin-bottom: 6px; }
.stat-value { font-family: var(--mono); font-size: 22px; font-weight: 700; color: var(--text); line-height: 1; }
.stat-value-row { display: flex; align-items: baseline; gap: 6px; }
.stat-pct { font-family: var(--mono); font-size: 11px; font-weight: 500; color: var(--text-3); }
```

```html
<div class="stats-grid">
    <div class="stat-card c-blue">
        <div class="stat-label">Total PAX</div>
        <div class="stat-value">1.204</div>
    </div>
    <div class="stat-card c-green">
        <div class="stat-label">Atribuídos</div>
        <div class="stat-value-row">
            <span class="stat-value">980</span>
            <span class="stat-pct">81%</span>
        </div>
    </div>
</div>
```

Assinatura: barra colorida de 3px na borda esquerda (`::before`) indicando status — não preencher o card inteiro de cor.

---

## 15. Componente: drop-zone (upload de arquivo)

```css
.drop-zone {
    border: 1px dashed var(--border-hi);
    border-radius: var(--radius-lg);
    padding: 24px 16px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px;
    cursor: pointer;
    background: var(--muted-dim);
    text-align: center;
    transition: border-color .2s, background .2s;
}
.drop-zone:hover { border-color: var(--accent); background: var(--accent-glow); }
.drop-zone.loaded { border-color: var(--success); border-style: solid; background: var(--success-dim); }

.drop-zone svg { color: var(--text-3); width: 22px; height: 22px; transition: color .2s; }
.drop-zone:hover svg { color: var(--accent); }
.drop-zone.loaded svg { color: var(--success); }

.drop-zone strong { font-size: 12px; font-weight: 500; color: var(--text); }
.drop-zone p { font-size: 11px; color: var(--text-3); font-family: var(--mono); }
.drop-zone .file-name { font-size: 10px; font-family: var(--mono); color: var(--success); }
```

Estado: borda tracejada neutra → hover azul → `.loaded` sólida verde. Sempre com `<input type="file" class="hidden">` por trás.

---

## 16. Componente: modal / loader

```css
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); backdrop-filter: blur(4px); z-index: 500; display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal-content { background: var(--bg-2); border: 1px solid var(--border-hi); border-radius: var(--radius-lg); width: 100%; max-width: 760px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; }
.modal-header { padding: 18px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.modal-body { padding: 20px; overflow-y: auto; flex: 1; }
.modal-footer { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; }
```

```css
#loader { position: fixed; inset: 0; background: rgba(13,15,17,.85); backdrop-filter: blur(4px); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 999; gap: 16px; }
.spinner { width: 36px; height: 36px; border: 2px solid var(--border-hi); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
```

Animação de entrada padrão para seções que aparecem dinamicamente:

```css
@keyframes fadeSlide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
/* aplicar: animation: fadeSlide .3s ease; */
```

---

## 17. Tela de Dashboard (hub de projetos)

O dashboard é a home que lista as ferramentas do workspace como cards clicáveis. Estrutura de referência: [dashboard.html](dashboard.html).

### Estrutura

```html
<header id="topbar">
    <div class="logo">
        <div class="logo-icon"><i data-lucide="layout-dashboard"></i></div>
        FLOW <span class="logo-sub">DASHBOARD</span>
    </div>
</header>

<div id="app">
    <div class="dash-header">
        <div class="dash-title"><span>Ferramentas</span></div>
        <span class="dash-sub">selecione um projeto para abrir</span>
    </div>

    <div class="projects-grid">
        <a href="pax_consolidar/index.html" class="project-card">
            <div class="card-top">
                <div class="card-icon ic-blue"><i data-lucide="users"></i></div>
                <span class="card-tag">escala</span>
            </div>
            <div class="card-body">
                <span class="card-name">PAX CONSOLIDAR</span>
                <span class="card-desc">Consolida viagens GPS -> Bilhetagem, verifica divergências, dentre outros.</span>
            </div>
            <div class="card-footer">
                <span class="btn btn-ghost" style="pointer-events:none;">
                    <i data-lucide="arrow-right"></i> Abrir
                </span>
            </div>
        </a>
        <!-- repetir 1 <a class="project-card"> por ferramenta -->
    </div>
</div>
```

### CSS específico do dashboard

```css
.dash-header { padding: 5px 0 8px; display: flex; flex-direction: column; gap: 6px; }

.dash-title {
    font-family: var(--mono); font-size: 22px; font-weight: 700; letter-spacing: .08em;
    color: var(--text);
    display: flex; align-items: center; gap: 14px;
}

.dash-sub {
    font-family: var(--mono); font-size: 11px; color: var(--text-3); letter-spacing: .06em;
    padding-left: 50px; /* alinha com o texto do título, não com o ícone */
}

.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
}

.project-card {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 22px;
    display: flex; flex-direction: column; gap: 14px;
    transition: border-color .2s, background .2s;
    text-decoration: none; color: inherit; cursor: pointer;
}
.project-card:hover { border-color: var(--border-hi); background: var(--bg-3); }

.card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }

.card-icon {
    width: 36px; height: 36px;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
}
.card-icon svg { width: 18px; height: 18px; color: white; }

.card-body { display: flex; flex-direction: column; gap: 5px; flex: 1; }
.card-name { font-family: var(--mono); font-size: 13px; font-weight: 700; letter-spacing: .06em; color: var(--text); }
.card-desc { font-size: 12px; color: var(--text-2); line-height: 1.6; } /* --sans, é o único texto corrido do card */

.card-footer { display: flex; align-items: center; justify-content: flex-end; }
```

### Regras de composição de um card de projeto

1. **Ícone colorido** (36×36, `border-radius:8px`) identificando a categoria — cor sólida de fundo (`ic-blue`, `ic-violet`, `ic-teal`, `ic-amber`, `ic-rose`), ícone Lucide branco dentro.
2. **Tag textual** no canto oposto ao ícone (`card-tag`) descrevendo o tipo de operação em 1 palavra minúscula ("escala", "geração", "exportação", "conferência", "utilitário").
3. **Nome do projeto** em CAIXA ALTA mono (`card-name`) — é o único elemento realmente "chamativo" do card, mas sem cor de destaque, só peso/tracking.
4. **Descrição curta** em sans, 1-2 linhas, tom neutro explicando o que a ferramenta faz.
5. **Rodapé com CTA fantasma** — sempre "Abrir" com seta, estilo `btn-ghost`, `pointer-events:none` (o card inteiro é o link, o botão é só indicação visual).
6. Cards nunca têm sombra; diferenciação por hover é só troca de `border-color` + `background` (de `--bg-2` para `--bg-3`, borda de `--border` para `--border-hi`).

Cores de ícone são **atribuídas por categoria semântica do domínio**, não por posição — reaproveitar a mesma cor quando dois projetos são do mesmo tipo (ex.: dois "geração" podem repetir `ic-violet`).

---

## 18. Checklist para replicar em um novo projeto

1. Copiar `static/css/app.css` (tokens + componentes base) como fundação.
2. Importar as duas fontes (JetBrains Mono + DM Sans) e o Lucide via CDN.
3. Montar `#topbar` fixo com `.logo` + `.logo-icon` + `.logo-sub`.
4. Envolver o conteúdo em `#app` (`max-width:1280px`, `padding:28px 24px 80px`, `gap:24px`).
5. Se o projeto tiver múltiplas etapas/fluxo: usar `.etapa-label` para dividir seções.
6. Reaproveitar `.card`, `.btn-*`, `.badge-*`, tabelas (`.table-wrap`) e `.filter-group` como estão — não recriar variantes.
7. Se precisar de uma home/hub listando sub-ferramentas: replicar a seção 17 (dashboard) tal qual, trocando ícone/cor/tag/nome/descrição por card.
8. Manter a regra de ouro: **mono + uppercase + tracking para tudo que é label/ação; sans normal só para frases explicativas.**
