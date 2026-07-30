-- Habilita Row Level Security nas tabelas.
-- Sem policies, o acesso anon/authenticated fica bloqueado (fecha a exposição pública).
-- O radar usa a service_role key, que BYPASSA RLS — não é afetado.

alter table public.vagas enable row level security;
alter table public.fonte_saude enable row level security;
alter table public.alertas enable row level security;
