// 04 — gate. Filtros duros, antes de gastar token de LLM. Função pura.
// Budget ausente NÃO é rejeição (só penalidade no score) — metade das vagas não publica faixa.
// Disponibilidade de horário/fuso NÃO é bloqueio (aceita reunião em qualquer fuso) — não há
// gate de overlap de timezone.
import { log } from "../lib/log.js";
import { fitSkill } from "../lib/fit.js";
import { avaliarGeo } from "../lib/geo.js";
import { pareceNaoVaga } from "../lib/validacao.js";
import { lusoHispano } from "../lib/idioma.js";
import { normalizarTexto } from "../lib/jaccard.js";

const RE_IDIOMA_OUTRO = /\bfluent\s+(?:in\s+)?(german|french|dutch|italian|japanese|mandarin|chinese|korean|arabic|russian|polish)\b/i;

// Vídeo obrigatório na candidatura (fala gravada) — descarta em qualquer mercado.
const RE_VIDEO_OBRIGATORIO =
  /\b(loom video|record(?:ing)? a (?:short )?video|video introduction|video application|video pitch|submit(?:ting)? a video|include a video|please (?:send|attach|record) a video)\b|\bv[ií]deo de apresenta[cç][aã]o\b|\bgrave um v[ií]deo\b|\benvie um v[ií]deo\b|\bscreencast\b/i;

// Núcleo do trabalho é falar inglês COM O CLIENTE (não alinhamento interno de time).
const RE_CORE_FALADO_CLIENTE =
  /\b(account manager|client success manager|customer success manager)\b|\b(?:lead(?:ing)?|host(?:ing)?|run(?:ning)?)\s+(?:client|customer)\s+calls\b|\blive (?:training|mentoring|coaching)\b|\bclient[- ]facing (?:calls|presentations|meetings)\b|\bpresent(?:ations)? to clients\b/i;

// Equipe exigida explicitamente — você trabalha com 1 colaborador, não é agência.
const RE_TEAM_REQUIRED = /\bteam required\b|\bnot for solo freelancers?\b|\bsolo freelancers? need not apply\b|\(team\)/i;

// Indicador de posição já preenchida.
const RE_HIRES_PREENCHIDA = /\bhires?:\s*1\b/i;

// Conta itens de lista (numerados ou com marcador) — proxy de "quantidade de entregas".
function contarEntregas(texto) {
  if (!texto) return 0;
  let n = 0;
  for (const linha of String(texto).split(/\n/)) {
    if (/^\s*(?:[-*•]|\d+[.)])\s+\S/.test(linha)) n++;
  }
  return n;
}

function casaTermo(hay, termo) {
  const t = normalizarTexto(termo);
  if (!t) return false;
  return new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(hay);
}

function contagemTermo(hay, termo) {
  const t = normalizarTexto(termo);
  if (!t) return 0;
  const re = new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "g");
  return (hay.match(re) || []).length;
}

// Stack em anti_stacks é "dominante" (requisito central, não menção de passagem) se: está no
// título, aparece logo no início da descrição, ou se repete 2+ vezes no corpo.
function stackDominante(vaga, termo) {
  const titulo = normalizarTexto(vaga.titulo);
  if (casaTermo(titulo, termo)) return true;
  const desc = normalizarTexto(vaga.descricao || "");
  if (casaTermo(desc.slice(0, 400), termo)) return true;
  return contagemTermo(desc, termo) >= 2;
}

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

  // Não é vaga? Página institucional/marketing raspada como posting — descarta antes do LLM.
  if (pareceNaoVaga(vaga)) {
    return { ok: false, motivo: "nao_vaga" };
  }

  // Vídeo obrigatório na candidatura (fala gravada) — qualquer mercado.
  if (RE_VIDEO_OBRIGATORIO.test(texto)) {
    return { ok: false, motivo: "video_obrigatorio" };
  }

  // Equipe exigida explicitamente.
  if (RE_TEAM_REQUIRED.test(texto)) {
    return { ok: false, motivo: "exige_equipe" };
  }

  // Indicador de posição já preenchida.
  if (RE_HIRES_PREENCHIDA.test(texto) || vaga.cliente_meta?.posicao_preenchida === true) {
    return { ok: false, motivo: "posicao_preenchida" };
  }

  // Cliente sem histórico avaliável — só quando a fonte traz o dado (hoje nenhum adapter
  // popula isso; fica pronto para quando a Fase 2/Upwork trouxer cliente_meta completo).
  const cm = vaga.cliente_meta || {};
  if (typeof cm.total_gasto_usd === "number" && cm.total_gasto_usd < 500) {
    return { ok: false, motivo: "cliente_sem_historico" };
  }
  if (typeof cm.avaliacoes === "number" && cm.avaliacoes === 0) {
    return { ok: false, motivo: "cliente_sem_historico" };
  }

  // Preço fixo baixo com escopo desproporcional (proxy: mais de 3 entregas listadas).
  if (vaga.tipo === "freelance_fixo" && vaga.budget_usd != null && vaga.budget_usd < 300) {
    if (contarEntregas(vaga.descricao) > 3) {
      return { ok: false, motivo: "escopo_desproporcional" };
    }
  }

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

  // Geografia: remoto passa; presencial/híbrido só passa dentro das zonas (z0/z1/z2)
  // e apenas quando geo.aceita_presencial. Com o switch desligado, comporta-se como antes.
  const geo = perfil.geo;
  const g = avaliarGeo(vaga, geo);
  if (g.presencial) {
    if (!geo?.aceita_presencial) {
      return { ok: false, motivo: "exige presença física / relocação" };
    }
    if (!g.zona) {
      return { ok: false, motivo: "fora_de_zona" };
    }
    // presencial/híbrido dentro de zona → passa
  }

  // Stack principal em anti_stacks: no título, logo no início da descrição, ou repetida
  // 2+ vezes no corpo (requisito central, não menção de passagem).
  const anti = (perfil.anti_stacks || []).find((s) => stackDominante(vaga, s));
  if (anti) {
    return { ok: false, motivo: `anti-stack: ${anti}` };
  }

  // Idioma exigido fora do perfil
  if (RE_IDIOMA_OUTRO.test(texto)) {
    return { ok: false, motivo: "exige idioma fora do perfil" };
  }

  // Núcleo do trabalho é falar inglês COM O CLIENTE (não alinhamento interno de time).
  // Só se aplica fora do mercado luso-hispano — lá o "falar" é em pt/es, sem problema.
  if (!lusoHispano(vaga) && RE_CORE_FALADO_CLIENTE.test(texto)) {
    return { ok: false, motivo: "ingles_falado_cliente" };
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
