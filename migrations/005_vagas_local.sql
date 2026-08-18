-- Radar Local Vigo: fluxo SEPARADO do radar remoto/tech. Banco próprio.

create table if not exists vagas_local (
  id             uuid primary key default gen_random_uuid(),
  fonte          text not null,
  fonte_id       text not null,
  url            text not null,
  titulo         text not null,
  empresa        text,
  descricao      text,
  local          text,            -- cidade/localização
  zona           text,            -- z0 | z1 | fora
  distancia_km   int,
  tipo_contrato  text,            -- indefinido/temporal/...
  jornada        text,            -- completa/parcial/...
  salario        text,            -- string livre (quando publicado)
  experiencia    text,            -- 'sin experiencia' | 'X años' | null
  publicado_em   timestamptz,
  hash           text not null,
  fingerprint    text,
  score          numeric,
  score_detalhe  jsonb,
  status         text default 'novo',
  criado_em      timestamptz default now(),
  unique (fonte, fonte_id)
);

create index if not exists vagas_local_score_idx on vagas_local (score desc, criado_em desc);
create index if not exists vagas_local_hash_idx on vagas_local (hash);
create index if not exists vagas_local_status_idx on vagas_local (status);

alter table vagas_local enable row level security;
