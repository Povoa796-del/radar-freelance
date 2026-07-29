// 05 — scoring determinístico (grátis). Calcula tudo menos viabilidade_agentes,
// que vem da camada LLM (06). Função pura.
import { normalizarTexto } from "../lib/jaccard.js";

// Casa `termo` como sequência de palavras no haystack normalizado (fronteira de palavra).
function casaTermo(hay, termo) {
  const t = normalizarTexto(termo);
  if (!t) return false;
  return new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(hay);
}

// Fit = interseção ponderada de palavras do perfil com o texto da vaga, normalizada 0–1.
// Usa fit_keywords (vocabulário em inglês, como as vagas são escritas); se ausente,
// cai para os stacks. Título pesa mais que a descrição.
function fitSkill(vaga, perfil) {
  const hayTitulo = normalizarTexto(`${vaga.skills.join(" ")} ${vaga.titulo}`);
  const hayDesc = normalizarTexto((vaga.descricao || "").slice(0, 1200));

  const kws = perfil.fit_keywords;
  let pontos = 0;
  if (kws && Object.keys(kws).length) {
    for (const [kw, peso] of Object.entries(kws)) {
      if (casaTermo(hayTitulo, kw)) pontos += peso; // título: peso cheio
      else if (casaTermo(hayDesc, kw)) pontos += peso * 0.5; // descrição: metade
    }
  } else {
    const hay = `${hayTitulo} ${hayDesc}`;
    for (const s of perfil.stacks_core || []) if (casaTermo(hay, s)) pontos += 1.0;
    for (const s of perfil.stacks_aceitaveis || []) if (casaTermo(hay, s)) pontos += 0.5;
  }
  return Math.min(1, pontos / 3); // ~3 acertos fortes saturam
}

// Escala log entre o mínimo e 5x o mínimo.
function ticket(vaga, perfil) {
  if (vaga.budget_usd == null) return null; // tratado como penalidade
  const min = vaga.tipo === "freelance_hora" ? perfil.pricing.hora_usd_min : perfil.pricing.fixo_usd_min;
  if (!min) return 0.5;
  const lo = Math.log(min);
  const hi = Math.log(5 * min);
  const v = (Math.log(Math.max(vaga.budget_usd, min)) - lo) / (hi - lo);
  return Math.max(0, Math.min(1, v));
}

function frescor(vaga) {
  if (!vaga.publicado_em) return 0.4;
  const h = (Date.now() - new Date(vaga.publicado_em).getTime()) / 36e5;
  if (h < 6) return 1.0;
  if (h < 24) return 0.7;
  if (h < 72) return 0.4;
  return 0.1;
}

function qualidadeCliente(vaga) {
  const m = vaga.cliente_meta || {};
  if (m.verificado === true) return 0.9;
  if (typeof m.hire_rate === "number") return Math.max(0, Math.min(1, m.hire_rate));
  return 0.5; // neutro — nunca penaliza por falta de dado
}

// Retorna a vaga anotada com score_base (sem viabilidade) e score_detalhe.
export function pontuar(vaga, perfil, pesos) {
  const fit = fitSkill(vaga, perfil);
  const tk = ticket(vaga, perfil);
  const fr = frescor(vaga);
  const qc = qualidadeCliente(vaga);

  let base =
    fit * pesos.fit_skill +
    (tk ?? 0) * pesos.ticket +
    fr * pesos.frescor +
    qc * pesos.qualidade_cliente;

  const penalidades = {};
  if (vaga.budget_usd == null) {
    penalidades.budget_ausente = pesos.penalidades.budget_ausente;
    base += pesos.penalidades.budget_ausente;
  }

  return {
    ...vaga,
    score_base: Math.round(base),
    score_detalhe: {
      fit_skill: Number(fit.toFixed(2)),
      ticket: tk == null ? null : Number(tk.toFixed(2)),
      frescor: Number(fr.toFixed(2)),
      qualidade_cliente: Number(qc.toFixed(2)),
      penalidades,
    },
  };
}

export function pontuarLote(vagas, perfil, pesos) {
  return vagas.map((v) => pontuar(v, perfil, pesos));
}
