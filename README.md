# BRIEF DE PROJETO — `radar-freelance`

Radar automatizado de oportunidades freelance e vagas remotas internacionais (USD/EUR),
com scoring de fit e alerta curado. Sem submissão automática de propostas.

---

## 1. Objetivo

Substituir a busca manual em plataformas por um pipeline que roda sozinho, filtra
agressivamente e entrega **2 alertas por dia com no máximo 5 oportunidades reais**,
já pontuadas por aderência ao perfil e viabilidade de execução com agentes de código.

Métrica de sucesso da v1: pelo menos 3 oportunidades/semana com score ≥ 75 que
justifiquem uma candidatura manual. Menos que isso = os pesos ou as fontes estão errados.

## 2. Escopo

**Dentro da v1**
- Coleta multi-fonte via APIs públicas (sem scraping, sem violar ToS)
- Normalização em schema único
- Deduplicação cross-fonte
- Gate por ticket mínimo e moeda
- Scoring híbrido (determinístico + LLM)
- Alerta curado no Telegram + histórico em Supabase
- Digest semanal com estatísticas por fonte

**Fora da v1 (slots reservados na arquitetura)**
- Geração de proposta/cover letter → Fase 4
- Submissão automática de bid → Fase 5, só onde a API permite formalmente
- Dashboard web

## 3. Stack

| Camada | Escolha | Justificativa |
|---|---|---|
| Runtime | Node.js 20, ESM | mesmo padrão dos outros pipelines |
| Estado | Supabase (Postgres) | histórico, dedupe, analytics |
| Agendamento | GitHub Actions (cron) | coletores têm I/O longo e parsing de e-mail; mais simples que Workers |
| LLM barato | DeepSeek (`deepseek-chat`) | classificação e extração em volume, ~10x mais barato |
| LLM bom | Claude (Anthropic API) | só no resumo do alerta e, na Fase 4, na proposta |
| Notificação | Telegram Bot API | mensagem com botões inline (interesse / descartar) |

Sem framework de agentes. Módulos puros, um arquivo por responsabilidade, igual aos
pipelines do Xadrez/Ajedrez.

## 4. Estrutura de pastas

```
radar-freelance/
├── src/
│   ├── index.js                 # orquestrador do ciclo
│   ├── agents/
│   │   ├── 01-coletor.js        # roda todos os adapters habilitados
│   │   ├── 02-normalizador.js   # RawJob -> Vaga
│   │   ├── 03-dedupe.js         # hash + Jaccard + cluster
│   │   ├── 04-gate.js           # filtros duros (ticket, moeda, idioma, anti-stack)
│   │   ├── 05-scorer.js         # score determinístico
│   │   ├── 06-qualificador.js   # camada LLM (viabilidade + risco)
│   │   └── 07-alerta.js         # curadoria + envio Telegram
│   ├── sources/
│   │   ├── _contract.js         # interface do adapter
│   │   ├── himalayas.js
│   │   ├── remoteok.js
│   │   ├── remotive.js
│   │   ├── jobicy.js
│   │   ├── arbeitnow.js
│   │   ├── hn-whoishiring.js
│   │   ├── freelancer.js        # Fase 3 (OAuth)
│   │   └── gmail-alerts.js      # Fase 2
│   ├── lib/
│   │   ├── supabase.js
│   │   ├── llm.js               # wrapper deepseek/anthropic com retry
│   │   ├── jaccard.js
│   │   ├── moeda.js             # normaliza tudo para USD
│   │   └── telegram.js
│   └── config/
│       ├── perfil.json          # ICP inverso — a peça central
│       ├── fontes.json
│       └── pesos.json
├── migrations/001_init.sql
├── reports/                     # digests semanais em md
├── .github/workflows/radar.yml
├── .env.example
└── README.md
```

## 5. Schema (Supabase)

```sql
create table vagas (
  id              uuid primary key default gen_random_uuid(),
  fonte           text not null,
  fonte_id        text not null,
  url             text not null,
  titulo          text not null,
  empresa         text,
  descricao       text,
  skills          text[] default '{}',
  tipo            text,              -- 'freelance_fixo' | 'freelance_hora' | 'emprego'
  budget_min      numeric,
  budget_max      numeric,
  moeda           text,
  budget_usd      numeric,           -- normalizado, usado no gate
  publicado_em    timestamptz,
  remoto          boolean default true,
  fuso_exigido    text,
  cliente_meta    jsonb default '{}',-- verificado, gasto histórico, país, hire rate
  hash            text not null,     -- sha256 da url canônica
  fingerprint     text,              -- titulo+empresa normalizados, para cluster
  score           numeric,
  score_detalhe   jsonb,
  llm_analise     jsonb,             -- {necessidade, viabilidade, risco, esforco_h}
  status          text default 'novo',
  criado_em       timestamptz default now(),
  unique (fonte, fonte_id)
);

create index on vagas (score desc, criado_em desc);
create index on vagas (hash);
create index on vagas (status);

create table fonte_saude (
  fonte        text primary key,
  ultimo_ok    timestamptz,
  ultimo_erro  text,
  erros_seguidos int default 0,
  itens_ultima_run int
);

create table alertas (
  id          uuid primary key default gen_random_uuid(),
  enviado_em  timestamptz default now(),
  vaga_ids    uuid[],
  canal       text default 'telegram'
);
```

Status válidos: `novo`, `alertado`, `interesse`, `descartado`, `aplicado`, `resposta`, `ganho`, `perdido`.
Os três últimos alimentam o feedback loop da Fase 6.

## 6. Contrato do adapter

Toda fonte exporta o mesmo objeto. Falha em uma fonte **nunca** derruba o ciclo:
`01-coletor.js` envolve cada `fetch()` em try/catch, grava em `fonte_saude` e segue.

```js
// src/sources/_contract.js
/**
 * @typedef {Object} SourceAdapter
 * @property {string}  name
 * @property {boolean} enabled
 * @property {number}  rateLimitMs
 * @property {(ctx: {since: Date, keywords: string[]}) => Promise<object[]>} fetch
 * @property {(raw: object) => Vaga} normalize
 */
```

Regra: `normalize()` é puro e testável. Para cada fonte, escrever um fixture em
`test/fixtures/<fonte>.json` capturado na primeira execução real — os schemas
dessas APIs mudam sem aviso e o fixture é o que detecta a quebra.

## 7. Fontes — v1

Todas gratuitas, JSON público, sem chave e sem anti-bot:

| Fonte | Endpoint | Notas |
|---|---|---|
| Himalayas | `https://himalayas.app/jobs/api` (browse) e endpoint de search | sem auth; **máximo 20 vagas por request** desde mar/2025, então paginar por offset. Pede link de volta e crédito à fonte. Também expõe um MCP server, útil para consulta ad-hoc |
| RemoteOK | `https://remoteok.com/api` | primeiro item do array é metadata legal, descartar. Atribuição obrigatória |
| Remotive | `https://remotive.com/api/remote-jobs?category=software-dev&limit=...` | curado, bom sinal/ruído |
| Jobicy | `https://jobicy.com/api/v2/remote-jobs?count=50&industry=...` | tech + marketing |
| Arbeitnow | `https://www.arbeitnow.com/api/job-board-api` | foco Europa/DACH, não retorna salário |
| HN Who is hiring | `https://hn.algolia.com/api/v1/...` | achar a thread mensal `Ask HN: Who is hiring?` pelo search, depois puxar os comentários top-level. **É a melhor fonte para gigs de IA/automação bem pagos** |

Validar cada endpoint na primeira execução e ajustar o normalize conforme o payload real.
Se um endpoint tiver mudado, registrar em `fonte_saude` e abrir issue — não travar o build.

**Fase 2 — o atalho para as plataformas fechadas.** Workana, Upwork, LinkedIn e
Wellfound não têm API utilizável, mas todas mandam alerta por e-mail. Criar saved
searches em cada uma, filtro no Gmail aplicando a label `radar/vagas`, e um adapter
`gmail-alerts.js` que lê essa label via Gmail API e parseia os anúncios. Zero scraping,
zero risco de ToS, e cobre exatamente o que falta. Um parser por remetente.

**Fase 3 — Freelancer.com.** Tem API oficial (v0.1, OAuth2) com busca de projetos
ativos e, diferente do Upwork, **bid via API é suportado**. Requer conta de dev em
`developers.freelancer.com` e existe sandbox (`https://www.freelancer-sandbox.com`)
para testar sem queimar nada. Upwork tem API GraphQL mas exige aprovação de app e
restringe submissão — deixar para depois.

## 8. `config/perfil.json` — a peça central

O scorer só é bom se este arquivo for honesto. Preencher assim:

```json
{
  "posicionamento": "Engenheiro de automação com IA e SEO programático — pipelines multi-agente, geração de conteúdo em escala, sites de alto volume",
  "base": { "pais": "ES", "fuso": "Europe/Madrid", "overlap_max_horas": 4 },
  "idiomas": ["pt", "es", "en"],
  "stacks_core": [
    "Node.js", "Next.js", "Cloudflare Workers/Pages", "Supabase/Postgres",
    "Anthropic API", "DeepSeek", "pipelines multi-agente", "Puppeteer",
    "SEO programático", "Remotion", "FFmpeg", "YouTube Data/Analytics API",
    "GA4/GTM", "automação de conteúdo"
  ],
  "stacks_aceitaveis": ["Python", "Astro", "Vercel", "n8n", "Airtable", "Stripe"],
  "anti_stacks": ["mobile nativo", "Java/.NET enterprise", "Salesforce", "Unity", "design gráfico puro"],
  "cases": [
    { "nome": "Comparar Cartões", "tipo": "SEO programático + pipeline de conteúdo", "stack": ["Next.js","Cloudflare","Supabase"], "resultado": "site comparador com 4 agentes de conteúdo automatizados e auditoria de dataset" },
    { "nome": "Libremente", "tipo": "migração de infra + redesign", "stack": ["Cloudflare Workers","Supabase"], "resultado": "saída de plataforma no-code para infra própria, com SEO e analytics completos" },
    { "nome": "Xadrez do Capital", "tipo": "pipeline de vídeo end-to-end", "stack": ["Node.js","DeepSeek","HeyGen","Remotion"], "resultado": "8 agentes, pesquisa a publicação, engine de vídeo reutilizável" },
    { "nome": "Radar Ajedrez", "tipo": "descoberta automatizada de pautas", "stack": ["Node.js"], "resultado": "9 agentes, dedupe por Jaccard com clustering de entidades" },
    { "nome": "carrossel-ig", "tipo": "CLI de geração de criativos", "stack": ["Node.js","Puppeteer","Anthropic API"], "resultado": "briefing JSON → carrossel renderizado" },
    { "nome": "Analista de desempenho YouTube", "tipo": "analytics + visão computacional", "stack": ["YouTube APIs","Claude vision"], "resultado": "correlação de CTR com features de título e thumbnail" }
  ],
  "pricing": { "hora_usd_min": 45, "fixo_usd_min": 800, "retainer_usd_mes_min": 1500 },
  "disponibilidade_h_semana": 20,
  "faturacao": { "regime": "autónomo ES", "moedas": ["EUR","USD"], "nota": "cliente fora da UE = exportação de serviço; cliente B2B na UE exige ROI/VIES — confirmar com asesor antes de faturar o primeiro" }
}
```

## 9. Gate (filtros duros) — `04-gate.js`

Descarta antes de gastar token de LLM. Rejeita se:

- `budget_usd` abaixo de `pricing.fixo_usd_min` (fixo) ou `hora_usd_min` (hora)
- moeda fora de `["USD","EUR","GBP","CHF"]`
- exige presença física, visto local ou relocação
- exige overlap de fuso maior que `overlap_max_horas` (padrão: rejeita "must overlap PST full day")
- stack principal em `anti_stacks`
- idioma exigido fora de `idiomas`
- publicado há mais de 7 dias

**Budget ausente não é rejeição automática** — cerca de metade das vagas não publica
faixa. Marcar `budget_usd = null` e aplicar penalidade no score, não no gate. Vaga sem
budget mas com fit alto ainda vale um alerta.

## 10. Scoring — `05-scorer.js` + `06-qualificador.js`

Determinístico primeiro (grátis), LLM só no que passou.

`config/pesos.json`:

```json
{
  "fit_skill": 30,
  "viabilidade_agentes": 20,
  "ticket": 25,
  "qualidade_cliente": 15,
  "frescor": 10,
  "penalidades": {
    "budget_ausente": -8,
    "equity_ou_revshare": -40,
    "teste_nao_pago": -25,
    "urgente_com_budget_baixo": -20,
    "nda_antes_da_descricao": -15,
    "exige_fulltime": -30
  }
}
```

- **fit_skill**: interseção ponderada entre skills extraídas e `stacks_core` (peso 1.0) /
  `stacks_aceitaveis` (0.5). Normalizar 0–1 e multiplicar pelo peso.
- **ticket**: escala log entre o mínimo e 5x o mínimo, saturando em 1.0.
- **frescor**: 1.0 se < 6h, 0.7 se < 24h, 0.4 se < 72h, 0.1 depois.
- **qualidade_cliente**: só preenchível nas fontes que dão metadata (Freelancer, alertas
  do Upwork). Default neutro 0.5 quando ausente — nunca penalizar por falta de dado.
- **viabilidade_agentes**: vem da camada LLM.

**Camada LLM (DeepSeek, JSON estrito, temperatura 0):**

```
Você analisa uma oportunidade de trabalho para um engenheiro de automação com IA.
Perfil: {perfil resumido}
Vaga: {titulo, descricao truncada em 4000 chars}

Responda APENAS com JSON, sem markdown:
{
  "necessidade_real": "1 frase: o que o cliente de fato precisa",
  "viabilidade_agentes": "alta|media|baixa",
  "justificativa_viabilidade": "1 frase",
  "esforco_horas_estimado": number,
  "risco_principal": "1 frase",
  "red_flags": ["equity_ou_revshare","teste_nao_pago","escopo_vago","exige_fulltime"]
}
```

`viabilidade_agentes: alta` = escopo delimitado, entregável é código/conteúdo/dado,
não depende de reuniões diárias nem de acesso a sistema interno legado.
Mapear alta=1.0, media=0.55, baixa=0.15.

Truncar a descrição antes de enviar. Uma run com 200 vagas coletadas deve custar
centavos — se estiver custando mais, o gate está frouxo.

## 11. Deduplicação — `03-dedupe.js`

Três camadas, na ordem:
1. `hash` da URL canônica (query params de tracking removidos) → descarte imediato
2. `fingerprint` = slug(titulo) + slug(empresa) → mesma vaga em boards diferentes,
   merge mantendo o registro de maior score e acumulando as fontes em `cliente_meta.fontes[]`
3. Jaccard sobre shingles de 3 palavras de `titulo + primeiros 500 chars da descrição`,
   threshold 0.75, janela de 30 dias — pega repost com título alterado

Reaproveitar a implementação de Jaccard do radar do Ajedrez.

## 12. Alerta curado — `07-alerta.js`

2x/dia (09:00 e 18:00 Europe/Madrid). Seleciona `status = 'novo'` e `score >= 70`,
ordena por score, corta em 5. **Se nenhuma passar, não manda nada** — radar que manda
mensagem vazia todo dia vira ruído e para de ser lido.

Formato por item:

```
🎯 87 · Himalayas
Automation Engineer — LLM content pipelines
Acme Labs · US$ 6.000–9.000 · fixo · há 3h

Precisa de um pipeline que transforme relatórios em posts publicados.
Viabilidade: alta — é exatamente o pipeline do Xadrez com outro output.
Risco: escopo de "integrações futuras" não definido.

🔗 {url}
[ Interesse ]  [ Descartar ]
```

Os botões inline atualizam `status` via callback query — é isso que gera o dataset
do feedback loop. Sem eles o radar não aprende.

## 13. Digest semanal

Domingo 20:00, gera `reports/YYYY-WW.md` e manda resumo no Telegram:
vagas coletadas por fonte, % que passou o gate, score médio, top 3 skills pedidas
nas vagas de score alto, taxa de "interesse" sobre alertadas, e saúde das fontes.

O objetivo real do digest é responder duas perguntas: **qual fonte merece continuar
ligada** e **qual skill o mercado está pedindo que ainda não está no perfil**.

## 14. Cron

```yaml
# .github/workflows/radar.yml
name: radar
on:
  schedule:
    - cron: '0 7,16 * * *'   # 09:00 e 18:00 CET
    - cron: '0 18 * * 0'     # digest semanal
  workflow_dispatch:
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: node src/index.js ${{ github.event.schedule == '0 18 * * 0' && '--digest' || '--ciclo' }}
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

Nota: o bot com botões inline precisa de um receptor de callback. Solução mínima:
um Cloudflare Worker de ~30 linhas com webhook do Telegram que só faz
`update vagas set status = $1 where id = $2`.

## 15. Fases

| Fase | Entrega | Esforço |
|---|---|---|
| 1 | 6 fontes JSON + normalizador + dedupe + gate + scorer + alerta | 1–2 dias |
| 2 | `gmail-alerts.js` (LinkedIn, Upwork, Workana, Toptal) | meio dia |
| 3 | Freelancer.com API via OAuth + metadata de cliente | meio dia |
| 4 | Agente redator de proposta usando o case bank do `perfil.json` | 1 dia |
| 5 | Submissão de bid no Freelancer.com com aprovação por botão | meio dia |
| 6 | Feedback loop: recalibra `pesos.json` a partir de ganho/perdido | 1 dia |

## 16. Critérios de aceitação da Fase 1

- [ ] `node src/index.js --ciclo` roda ponta a ponta sem chave de API de nenhuma fonte
- [ ] Uma fonte fora do ar não impede as outras; registra em `fonte_saude`
- [ ] Rodar duas vezes seguidas não gera duplicata nem alerta repetido
- [ ] Teste unitário de `normalize()` por fonte, com fixture real
- [ ] Custo de LLM por ciclo abaixo de US$ 0,10
- [ ] Alerta não é enviado quando nada passa o corte
- [ ] `perfil.json` e `pesos.json` alteráveis sem tocar em código

---

## Anexo — redes fechadas: candidatura manual única, alto retorno

O radar cobre o fluxo contínuo. Mas para freelance internacional em USD/EUR, as redes
com curadoria pagam 2–4x o preço dos boards abertos e o custo é **uma** candidatura
manual. Vale fazer em paralelo à Fase 1, não depois:

- **Toptal** — processo longo (teste técnico + entrevista), mas taxa horária alta
- **Braintrust** — sem fee para o freelancer, clientes enterprise
- **Gun.io / Lemon.io** — foco em dev sênior, matching rápido
- **A.Team** — squads de produto, contratos de meses
- **Contra** — zero fee, bom para inbound com portfólio forte
- **Pangea / Upwork (perfil otimizado)** — volume, útil como piso

Para todas, o ativo é o mesmo: os 6 cases do `perfil.json` escritos como estudo de caso
com número. Escrever uma vez, reusar em todas.