// 05 — scoring determinístico (v2, renormalizado). Componente sem dado sai do numerador
// E do denominador — não entra como 0 nem como 0.5. Função pura.
//   score = (Σ peso*valor dos componentes com dado) / (Σ pesos aplicáveis) * 100
// A viabilidade_agentes é injetada pela camada LLM (06) via montarScore().
import { fitSkill } from "../lib/fit.js";
import { paraUSD } from "../lib/moeda.js";

export function trilhaDe(vaga) {
  return vaga.tipo === "emprego" ? "emprego" : "freelance";
}

// Ticket freelance: escala log entre o mínimo e 5x o mínimo (seção 10 do brief).
function ticketFreelance(vaga, perfil) {
  const min = vaga.tipo === "freelance_hora" ? perfil.pricing.hora_usd_min : perfil.pricing.fixo_usd_min;
  if (!min) return 0.5;
  const lo = Math.log(min);
  const hi = Math.log(5 * min);
  const v = (Math.log(Math.max(vaga.budget_usd, min)) - lo) / (hi - lo);
  return Math.max(0, Math.min(1, v));
}

// Ticket emprego: salário anual linear (EUR 55k => 0, EUR 110k => 1.0), saturando.
function ticketEmprego(vaga, pesos) {
  const eur = pesos.ticket_emprego_eur || { min: 55000, max: 110000 };
  const min = paraUSD(eur.min, "EUR");
  const max = paraUSD(eur.max, "EUR");
  return Math.max(0, Math.min(1, (vaga.budget_usd - min) / (max - min)));
}

function frescorValor(vaga) {
  const h = (Date.now() - new Date(vaga.publicado_em).getTime()) / 36e5;
  if (h < 6) return 1.0;
  if (h < 24) return 0.7;
  if (h < 72) return 0.4;
  return 0.1;
}

// Qualidade do cliente só existe onde há metadata; sem dado retorna null (componente ausente).
function qualidadeValor(vaga) {
  const m = vaga.cliente_meta || {};
  if (m.verificado === true) return 0.9;
  if (typeof m.hire_rate === "number") return Math.max(0, Math.min(1, m.hire_rate));
  return null;
}

// Monta os componentes determinísticos COM DADO. fit_skill está sempre presente.
export function componentesDeterministicos(vaga, perfil, pesos) {
  const trilha = trilhaDe(vaga);
  const componentes = { fit_skill: { peso: pesos.fit_skill, valor: fitSkill(vaga, perfil) } };

  if (vaga.budget_usd != null) {
    const valor = trilha === "emprego" ? ticketEmprego(vaga, pesos) : ticketFreelance(vaga, perfil);
    componentes.ticket = { peso: pesos.ticket, valor };
  }
  const q = qualidadeValor(vaga);
  if (q != null) componentes.qualidade_cliente = { peso: pesos.qualidade_cliente, valor: q };
  if (vaga.publicado_em) componentes.frescor = { peso: pesos.frescor, valor: frescorValor(vaga) };

  return { trilha, componentes };
}

// Renormaliza sobre os pesos aplicáveis (inclui viabilidade) e subtrai penalidades.
// Só deve ser chamada quando fit_skill E viabilidade_agentes existem (guarda-corpo em 06).
export function montarScore({ trilha, componentes }, viabilidadeNorm, penalidades = {}, pesos) {
  const todos = {
    ...componentes,
    viabilidade_agentes: { peso: pesos.viabilidade_agentes, valor: viabilidadeNorm },
  };

  let num = 0;
  let den = 0;
  const pesos_aplicados = {};
  const valores = {};
  for (const [nome, { peso, valor }] of Object.entries(todos)) {
    num += peso * valor;
    den += peso;
    pesos_aplicados[nome] = peso;
    valores[nome] = Number(valor.toFixed(2));
  }

  const renormalizado = den ? (num / den) * 100 : 0;
  const somaPen = Object.values(penalidades).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.round(renormalizado + somaPen));

  return {
    score,
    score_detalhe: {
      versao: 2,
      trilha,
      ...valores,
      pesos_aplicados,
      denominador: den,
      renormalizado: Math.round(renormalizado),
      penalidades,
    },
  };
}
