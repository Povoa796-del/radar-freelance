// 05 — scoring determinístico (grátis). Calcula tudo menos viabilidade_agentes (LLM, 06).
// Duas trilhas com normalização de ticket própria: 'freelance' e 'emprego'. Função pura.
import { fitSkill } from "../lib/fit.js";
import { paraUSD } from "../lib/moeda.js";

export function trilhaDe(vaga) {
  return vaga.tipo === "emprego" ? "emprego" : "freelance";
}

// Ticket da trilha freelance: escala log entre o mínimo e 5x o mínimo (seção 10 do brief).
function ticketFreelance(vaga, perfil) {
  if (vaga.budget_usd == null) return null; // vira penalidade budget_ausente
  const min = vaga.tipo === "freelance_hora" ? perfil.pricing.hora_usd_min : perfil.pricing.fixo_usd_min;
  if (!min) return 0.5;
  const lo = Math.log(min);
  const hi = Math.log(5 * min);
  const v = (Math.log(Math.max(vaga.budget_usd, min)) - lo) / (hi - lo);
  return Math.max(0, Math.min(1, v));
}

// Ticket da trilha emprego: salário anual linear (EUR 55k => 0, EUR 110k => 1.0), saturando.
function ticketEmprego(vaga, pesos) {
  if (vaga.budget_usd == null) return 0; // sem penalidade na trilha emprego
  const eur = pesos.ticket_emprego_eur || { min: 55000, max: 110000 };
  const min = paraUSD(eur.min, "EUR");
  const max = paraUSD(eur.max, "EUR");
  const v = (vaga.budget_usd - min) / (max - min);
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

export function pontuar(vaga, perfil, pesos) {
  const trilha = trilhaDe(vaga);
  const fit = fitSkill(vaga, perfil);
  const tk = trilha === "emprego" ? ticketEmprego(vaga, pesos) : ticketFreelance(vaga, perfil);
  const fr = frescor(vaga);
  const qc = qualidadeCliente(vaga);

  let base =
    fit * pesos.fit_skill +
    (tk ?? 0) * pesos.ticket +
    fr * pesos.frescor +
    qc * pesos.qualidade_cliente;

  // budget_ausente só penaliza a trilha freelance.
  const penalidades = {};
  if (trilha === "freelance" && vaga.budget_usd == null) {
    penalidades.budget_ausente = pesos.penalidades.budget_ausente;
    base += pesos.penalidades.budget_ausente;
  }

  return {
    ...vaga,
    score_base: Math.round(base),
    score_detalhe: {
      trilha,
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
