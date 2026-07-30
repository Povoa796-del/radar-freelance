# radar-freelance

Radar de oportunidades freelance internacionais com scoring e alerta curado.
**Especificação completa: [`docs/BRIEF_PROJETO.md`](docs/BRIEF_PROJETO.md) — leia antes de qualquer alteração.**

## Regras de trabalho
- Node.js 20, ESM (`import`, não `require`)
- Sem framework de agentes. Módulos puros, uma responsabilidade por arquivo
- Toda função de `normalize()` é pura e tem teste com fixture real em `test/fixtures/`
- Falha de uma fonte nunca derruba o ciclo: try/catch por fonte + registro em `fonte_saude`
- Nunca commitar `.env`. Segredos só por variável de ambiente
- Um commit por etapa concluída, mensagem em português
- Não instalar dependência nova sem me avisar antes

## Git / tags
- **Tag é imutável.** Nunca mover uma tag existente.
- **Proibido `git tag -f` e `git push --tags --force`.**
- Para marcar um novo ponto, crie uma tag nova (ex: `v1.1-pre-cron`), nunca reaproveite o nome de uma existente.

## Comandos
- `node src/index.js --ciclo` — roda um ciclo completo (callbacks → coleta → alerta)
- `node src/index.js --digest` — gera o relatório semanal
- `node src/index.js --callbacks` — processa os cliques dos botões do Telegram
- `node src/index.js --rescore` — re-pontua as vagas gravadas com o modelo atual
- `npm test` — testes de `normalize()` + scoring + funções puras
