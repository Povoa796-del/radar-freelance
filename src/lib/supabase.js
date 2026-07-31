// Camada de estado: cliente Supabase + acesso às tabelas vagas / fonte_saude / alertas.
import { createClient } from "@supabase/supabase-js";

let _client = null;

export function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios (defina no .env ou no ambiente)."
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// Colunas persistidas (evita mandar campos internos como score_base).
const COLUNAS = [
  "fonte", "fonte_id", "url", "titulo", "empresa", "descricao", "skills",
  "tipo", "budget_min", "budget_max", "moeda", "budget_usd", "publicado_em",
  "remoto", "fuso_exigido", "cliente_meta", "hash", "fingerprint",
  "score", "score_detalhe", "llm_analise", "status",
];

function paraRegistro(vaga) {
  const r = {};
  for (const c of COLUNAS) if (vaga[c] !== undefined) r[c] = vaga[c];
  return r;
}

// Insere vagas novas ignorando conflito em (fonte, fonte_id). Retorna as linhas inseridas.
export async function inserirVagas(vagas) {
  if (!vagas.length) return [];
  const { data, error } = await getClient()
    .from("vagas")
    .upsert(vagas.map(paraRegistro), { onConflict: "fonte,fonte_id", ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data || [];
}

// Vagas recentes (para dedupe por hash/fingerprint/Jaccard dentro da janela).
// Busca por janela de tempo, não pela lista de entrada — evita URL gigante no PostgREST.
export async function vagasRecentes(dias = 30) {
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const { data, error } = await getClient()
    .from("vagas")
    .select("id, titulo, empresa, descricao, hash, fingerprint, score, cliente_meta")
    .gte("criado_em", desde);
  if (error) throw error;
  return data || [];
}

export async function registrarSaudeFonte(fonte, { ok, erro = null, itens = 0 }) {
  const client = getClient();
  const { data } = await client
    .from("fonte_saude")
    .select("erros_seguidos")
    .eq("fonte", fonte)
    .maybeSingle();
  const errosSeguidos = ok ? 0 : (data?.erros_seguidos || 0) + 1;
  const patch = {
    fonte,
    erros_seguidos: errosSeguidos,
    itens_ultima_run: itens,
  };
  if (ok) patch.ultimo_ok = new Date().toISOString();
  else patch.ultimo_erro = String(erro).slice(0, 500);
  const { error } = await client.from("fonte_saude").upsert(patch, { onConflict: "fonte" });
  if (error) throw error;
}

// Candidatas ao alerta de uma trilha: status 'novo', score no corte e tipo na lista.
export async function candidatasAlertaTrilha(scoreMin, tipos, limite) {
  const { data, error } = await getClient()
    .from("vagas")
    .select("*")
    .eq("status", "novo")
    .gte("score", scoreMin)
    .in("tipo", tipos)
    .order("score", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

// Todas as vagas (para re-pontuação v2). Traz o que o scorer precisa recomputar.
export async function todasVagas() {
  const { data, error } = await getClient()
    .from("vagas")
    .select("id, titulo, descricao, skills, tipo, budget_usd, publicado_em, cliente_meta, status, score_detalhe, llm_analise");
  if (error) throw error;
  return data || [];
}

// Fase 2 — e-mails já processados (dedupe por message_id).
export async function emailJaProcessado(messageId) {
  if (!messageId) return false;
  const { data, error } = await getClient()
    .from("emails_processados")
    .select("message_id")
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function registrarEmailProcessado({ messageId, remetente, assunto }, vagasExtraidas = 0) {
  const { error } = await getClient()
    .from("emails_processados")
    .upsert(
      { message_id: messageId, remetente, assunto, vagas_extraidas: vagasExtraidas },
      { onConflict: "message_id" }
    );
  if (error) throw error;
}

export async function buscarVaga(id) {
  const { data, error } = await getClient().from("vagas").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function atualizarScore(id, patch) {
  const { error } = await getClient().from("vagas").update(patch).eq("id", id);
  if (error) throw error;
}

// Sonda: a vaga de maior score na banda [min, max) ainda 'novo'. Máximo 1.
export async function candidataSonda(min, max) {
  const { data, error } = await getClient()
    .from("vagas")
    .select("*")
    .eq("status", "novo")
    .gte("score", min)
    .lt("score", max)
    .order("score", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export async function marcarStatus(ids, status) {
  if (!ids.length) return;
  const { error } = await getClient().from("vagas").update({ status }).in("id", ids);
  if (error) throw error;
}

export async function registrarAlerta(vagaIds, canal = "telegram") {
  const { error } = await getClient().from("alertas").insert({ vaga_ids: vagaIds, canal });
  if (error) throw error;
}

// Estatísticas para o digest semanal.
export async function estatisticasSemana(dias = 7) {
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const { data: vagas, error } = await getClient()
    .from("vagas")
    .select("fonte, score, status, skills, score_detalhe, criado_em")
    .gte("criado_em", desde);
  if (error) throw error;
  const { data: saude } = await getClient().from("fonte_saude").select("*");
  return { vagas: vagas || [], saude: saude || [] };
}
