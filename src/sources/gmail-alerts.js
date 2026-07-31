// Fase 2 — coleta via alertas de e-mail das redes fechadas (Upwork, LinkedIn, Workana).
// Lê a label "radar" do Gmail, roteia cada e-mail para o parser do remetente, e
// dedupa por messageId (tabela emails_processados) para não reprocessar.
//
// Remetente sem parser → descarta silenciosamente e loga a contagem (nunca inventa campo).
// NÃO registrado no coletor até imapflow/mailparser instalados e os parsers escritos.
import { lerNaoLidas } from "../lib/imap.js";
import { parserPara } from "../parsers/index.js";
import { emailJaProcessado, registrarEmailProcessado } from "../lib/supabase.js";
import { montarVaga, stripHtml, inferirTipo } from "../lib/vaga.js";
import { log, warn } from "../lib/log.js";

async function fetch(ctx = {}) {
  const cfg = ctx.config || {};
  const label = cfg.label || "radar";
  const mensagens = await lerNaoLidas(label, { limite: cfg.limite ?? 50 });

  const raws = [];
  let semParser = 0;
  let jaVistos = 0;
  for (const m of mensagens) {
    if (await emailJaProcessado(m.messageId)) {
      jaVistos++;
      continue;
    }
    const parser = parserPara(m.remetente);
    if (!parser) {
      semParser++;
      await registrarEmailProcessado(m, 0);
      continue;
    }
    let vagas = [];
    try {
      vagas = parser.parse(m.html, m) || [];
    } catch (err) {
      warn(`gmail-alerts: parser ${parser.nome} falhou em "${m.assunto?.slice(0, 40)}": ${err.message}`);
    }
    // Anexa a data do e-mail como fallback de publicado_em.
    for (const v of vagas) v._data = v.publicado_em || m.data;
    raws.push(...vagas);
    await registrarEmailProcessado(m, vagas.length);
  }

  log(`gmail-alerts: ${mensagens.length} e-mail(s), ${raws.length} vagas, ${semParser} sem parser, ${jaVistos} já vistos`);
  return raws;
}

// RawJob (do parser) -> Vaga. fonte = a plataforma de origem (upwork/linkedin/workana).
function normalize(raw) {
  return montarVaga({
    fonte: raw.origem || "gmail",
    fonte_id: raw.fonte_id || raw.url,
    url: raw.url,
    titulo: raw.titulo,
    empresa: raw.empresa || null,
    descricao: raw.descricao ? stripHtml(raw.descricao) : null,
    skills: raw.skills || [],
    tipo: inferirTipo(raw.tipo, null, raw.titulo),
    budget_min: raw.budget_min ?? null,
    budget_max: raw.budget_max ?? null,
    moeda: raw.moeda || null,
    publicado_em: raw.publicado_em || raw._data,
    remoto: raw.remoto ?? true,
    fuso_exigido: raw.local || null,
    cliente_meta: { origem: raw.origem || null, local: raw.local || null },
  });
}

export default { name: "gmail-alerts", enabled: false, rateLimitMs: 0, fetch, normalize };
