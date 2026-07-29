// 04 — gate. Filtros duros, antes de gastar token de LLM. Função pura.
// Budget ausente NÃO é rejeição (só penalidade no score) — metade das vagas não publica faixa.
import { log } from "../lib/log.js";
import { fitSkill } from "../lib/fit.js";

const RE_PRESENCIAL = /\b(on-?site|in-?office|hybrid|relocat|must be (?:located|based)|presencial|no remote)\b/i;
const RE_OVERLAP_DURO = /(overlap|work).{0,30}(full[- ]?day|8\s*hours|6\s*hours|7\s*hours)|must overlap.{0,30}(pst|pacific|est|eastern)/i;
const RE_IDIOMA_OUTRO = /\bfluent\s+(?:in\s+)?(german|french|dutch|italian|japanese|mandarin|chinese|korean|arabic|russian|polish)\b/i;

function idadeDias(publicado_em) {
  if (!publicado_em) return null;
  const d = new Date(publicado_em);
  if (isNaN(d)) return null;
  return (Date.now() - d.getTime()) / 864e5;
}

// Retorna { ok: true } ou { ok: false, motivo }.
export function avaliarGate(vaga, perfil, gateCfg) {
  const texto = `${vaga.titulo} ${vaga.descricao || ""}`.toLowerCase();
  const pricing = perfil.pricing || {};
  const moedas = gateCfg.moedas_aceitas || ["USD", "EUR", "GBP", "CHF"];
  const maxDias = gateCfg.max_dias_publicado ?? 7;
  const fitMin = gateCfg.fit_minimo ?? 0.45;

  // Fit mínimo obrigatório: descarta fora do nicho, independente de ticket/salário.
  const fit = fitSkill(vaga, perfil);
  if (fit < fitMin) {
    return { ok: false, motivo: `fit ${fit.toFixed(2)} < mínimo ${fitMin}` };
  }

  // Ticket mínimo (só quando há budget)
  if (vaga.budget_usd != null) {
    const min = vaga.tipo === "freelance_hora" ? pricing.hora_usd_min : pricing.fixo_usd_min;
    if (min && vaga.budget_usd < min) {
      return { ok: false, motivo: `ticket ${vaga.budget_usd} < mínimo ${min}` };
    }
  }

  // Moeda (só quando conhecida)
  if (vaga.moeda && !moedas.includes(vaga.moeda.toUpperCase())) {
    return { ok: false, motivo: `moeda ${vaga.moeda} fora de ${moedas.join("/")}` };
  }

  // Presença física / relocação
  if (vaga.remoto === false || RE_PRESENCIAL.test(texto)) {
    return { ok: false, motivo: "exige presença física / relocação" };
  }

  // Overlap de fuso exigente
  if (RE_OVERLAP_DURO.test(texto)) {
    return { ok: false, motivo: "exige overlap de fuso grande" };
  }

  // Stack principal em anti_stacks
  const anti = (perfil.anti_stacks || []).find((s) => vaga.titulo.toLowerCase().includes(s.toLowerCase()));
  if (anti) {
    return { ok: false, motivo: `anti-stack no título: ${anti}` };
  }

  // Idioma exigido fora do perfil
  if (RE_IDIOMA_OUTRO.test(texto)) {
    return { ok: false, motivo: "exige idioma fora do perfil" };
  }

  // Frescor
  const idade = idadeDias(vaga.publicado_em);
  if (idade != null && idade > maxDias) {
    return { ok: false, motivo: `publicado há ${idade.toFixed(0)}d (> ${maxDias}d)` };
  }

  return { ok: true };
}

export function filtrarGate(vagas, perfil, gateCfg) {
  const aprovadas = [];
  const motivos = {};
  for (const v of vagas) {
    const r = avaliarGate(v, perfil, gateCfg);
    if (r.ok) aprovadas.push(v);
    else motivos[r.motivo] = (motivos[r.motivo] || 0) + 1;
  }
  const rejeitadas = vagas.length - aprovadas.length;
  log(`gate: ${aprovadas.length} passaram, ${rejeitadas} rejeitadas`);
  return { aprovadas, motivos };
}
