-- Hardening: constraints de integridade + view de ranking.
-- (002 é o 002_rls.sql; este é o 003.)

-- CHECK constraints — status e tipo válidos (status válidos do brief, seção 5).
alter table vagas add constraint vagas_status_check
  check (status in ('novo', 'alertado', 'interesse', 'descartado', 'aplicado', 'resposta', 'ganho', 'perdido'));

alter table vagas add constraint vagas_tipo_check
  check (tipo in ('freelance_fixo', 'freelance_hora', 'emprego'));

-- View de ranking: leitura rápida das vagas pontuadas, do melhor para o pior.
create or replace view v_ranking as
select
  score,
  fonte,
  titulo,
  empresa,
  budget_usd,
  tipo,
  status,
  llm_analise->>'viabilidade_agentes' as viabilidade,
  llm_analise->>'risco_principal'      as risco,
  publicado_em,
  url
from vagas
order by score desc nulls last;
