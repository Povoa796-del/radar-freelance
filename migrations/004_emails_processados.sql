-- Fase 2: controle de e-mails já lidos (não reprocessar o mesmo e-mail).

create table if not exists emails_processados (
  message_id      text primary key,
  remetente       text,
  assunto         text,
  vagas_extraidas int default 0,
  processado_em   timestamptz default now()
);

alter table emails_processados enable row level security;
