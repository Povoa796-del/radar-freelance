-- Schema inicial do radar-freelance.

create table if not exists vagas (
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

create index if not exists vagas_score_idx on vagas (score desc, criado_em desc);
create index if not exists vagas_hash_idx on vagas (hash);
create index if not exists vagas_status_idx on vagas (status);
create index if not exists vagas_fingerprint_idx on vagas (fingerprint);
create index if not exists vagas_criado_idx on vagas (criado_em);

create table if not exists fonte_saude (
  fonte            text primary key,
  ultimo_ok        timestamptz,
  ultimo_erro      text,
  erros_seguidos   int default 0,
  itens_ultima_run int
);

create table if not exists alertas (
  id          uuid primary key default gen_random_uuid(),
  enviado_em  timestamptz default now(),
  vaga_ids    uuid[],
  canal       text default 'telegram'
);
