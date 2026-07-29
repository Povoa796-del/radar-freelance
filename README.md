# radar-freelance

Radar automatizado de oportunidades freelance e vagas remotas internacionais (USD/EUR),
com scoring de fit e alerta curado no Telegram. Sem submissão automática de propostas.

**Especificação completa: [`docs/BRIEF_PROJETO.md`](docs/BRIEF_PROJETO.md) — leia antes de qualquer alteração.**

## Como funciona

```
6 fontes (APIs públicas)
  → normalização em schema único (normalize() puro por fonte)
  → dedupe em 3 camadas (hash da URL · fingerprint título+empresa · Jaccard)
  → gate de filtros duros (ticket, moeda, presencial, fuso, idioma, frescor)
  → scoring determinístico (fit + ticket + frescor + qualidade)
  → camada LLM (DeepSeek) só no que pode alertar → viabilidade + red flags
  → alerta curado no Telegram (2x/dia, no máx. 5, nada se nada passa o corte)
```

Estado, histórico e deduplicação ficam no Supabase. Agendamento por GitHub Actions.

## Fontes v1

Himalayas · RemoteOK · Remotive · Jobicy · Arbeitnow · HN "Who is hiring?"
(todas APIs públicas, sem chave, sem scraping). Fases 2–3 (alertas de e-mail das
redes fechadas e Freelancer.com via OAuth) estão desenhadas no brief.

## Setup

```bash
npm install
cp .env.example .env   # preencha as chaves (Supabase, DeepSeek, Telegram)
```

Aplique o schema no Supabase (uma vez): rode `migrations/001_init.sql` no SQL Editor
do projeto, ou via `supabase db`.

### Telegram (obrigatório para receber alertas)

1. O bot já existe: **@radarfreela_bot**.
2. Abra o Telegram, procure **@radarfreela_bot** e aperte **Start** (o bot não pode
   te mandar mensagem antes de você iniciar a conversa — sem isso o envio dá
   `chat not found`).
3. Confirme que `TELEGRAM_CHAT_ID` no `.env` é o seu id de usuário.

## Comandos

```bash
node src/index.js --ciclo    # um ciclo completo (coleta → alerta)
node src/index.js --digest   # relatório semanal (reports/YYYY-WW.md)
npm test                     # testes de normalize() + funções puras
```

## Configuração (sem tocar em código)

| Arquivo | O quê |
|---|---|
| `src/config/perfil.json` | seu ICP: posicionamento, stacks, `fit_keywords`, pricing, cases |
| `src/config/pesos.json` | pesos do score e penalidades; `fit_minimo` |
| `src/config/fontes.json` | fontes on/off, keywords, gate (moedas, dias), corte do alerta |

O scoring está calibrado como **fit-dominante**: `fit_keywords` + viabilidade valem
65% do score, para gigs de IA/automação vencerem vagas fora do nicho com salário alto.

## Agendamento

`.github/workflows/radar.yml` roda o ciclo às 09:00 e 18:00 CET e o digest aos
domingos. Configure os secrets do repositório com os mesmos nomes do `.env`.

## Regras do projeto

Node.js 20 · ESM · sem framework de agentes · um arquivo por responsabilidade ·
`normalize()` puro e testado com fixture real · falha de uma fonte nunca derruba o
ciclo · segredos só por variável de ambiente (nunca commitar `.env`).
