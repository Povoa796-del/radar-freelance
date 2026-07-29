// Testes das funções puras de apoio: moeda, jaccard, gate e scorer.
import { test } from "node:test";
import assert from "node:assert/strict";

import { paraUSD, detectarMoeda, moedaSuportada } from "../src/lib/moeda.js";
import { similaridade, shingles, normalizarTexto } from "../src/lib/jaccard.js";
import { montarVaga, urlCanonica, parseSalario } from "../src/lib/vaga.js";
import { avaliarGate } from "../src/agents/04-gate.js";
import { pontuar } from "../src/agents/05-scorer.js";

const perfil = {
  pricing: { hora_usd_min: 45, fixo_usd_min: 800 },
  anti_stacks: ["Unity", "Salesforce"],
  fit_keywords: { automation: 1.0, llm: 1.0, node: 1.0, "next.js": 1.0 },
};
const pesos = {
  fit_skill: 40, viabilidade_agentes: 25, ticket: 12, qualidade_cliente: 8,
  frescor: 15, penalidades: { budget_ausente: -4 },
};
const gateCfg = { moedas_aceitas: ["USD", "EUR", "GBP", "CHF"], max_dias_publicado: 7 };

test("moeda: conversão e detecção", () => {
  assert.equal(paraUSD(100, "USD"), 100);
  assert.equal(paraUSD(100, "EUR"), 108);
  assert.equal(paraUSD(100, "XYZ"), null);
  assert.equal(detectarMoeda("faixa de €50k"), "EUR");
  assert.equal(detectarMoeda("USD 3000"), "USD");
  assert.ok(moedaSuportada("gbp"));
});

test("jaccard: idênticos, parecidos, diferentes", () => {
  assert.equal(similaridade("a b c d", "a b c d"), 1);
  assert.ok(similaridade("senior node automation engineer", "node automation engineer wanted") > 0);
  assert.equal(similaridade("aa bb cc", "xx yy zz"), 0);
  assert.equal(normalizarTexto("Automação!"), "automacao");
  assert.ok(shingles("um dois tres quatro", 3).has("um dois tres"));
});

test("vaga: url canônica remove tracking", () => {
  const u = urlCanonica("https://Ex.com/job/1?utm_source=x&ref=y&id=9#frag");
  assert.ok(!u.includes("utm_source") && !u.includes("ref=y"));
  assert.ok(u.includes("id=9"));
});

test("vaga: parseSalario", () => {
  const s = parseSalario("$50k - $80k");
  assert.equal(s.min, 50000);
  assert.equal(s.max, 80000);
  assert.equal(s.moeda, "USD");
});

function vagaBase(over = {}) {
  return montarVaga({
    fonte: "teste", fonte_id: "1", url: "https://ex.com/1",
    titulo: "AI Automation Engineer (LLM, Node.js)",
    descricao: "Build automation pipelines with LLM and Node.js",
    skills: ["automation", "llm"], tipo: "freelance_fixo",
    budget_min: 2000, budget_max: 5000, moeda: "USD",
    publicado_em: new Date().toISOString(), remoto: true, ...over,
  });
}

test("gate: aprova vaga no nicho, rejeita presencial e ticket baixo", () => {
  assert.equal(avaliarGate(vagaBase(), perfil, gateCfg).ok, true);
  assert.equal(avaliarGate(vagaBase({ remoto: false }), perfil, gateCfg).ok, false);
  assert.equal(avaliarGate(vagaBase({ budget_min: 100, budget_max: 200 }), perfil, gateCfg).ok, false);
  assert.equal(avaliarGate(vagaBase({ moeda: "BRL" }), perfil, gateCfg).ok, false);
});

test("gate: budget ausente NÃO rejeita", () => {
  const r = avaliarGate(vagaBase({ budget_min: null, budget_max: null, moeda: null }), perfil, gateCfg);
  assert.equal(r.ok, true);
});

test("scorer: vaga no nicho pontua bem; fit alto", () => {
  const p = pontuar(vagaBase(), perfil, pesos);
  assert.ok(p.score_detalhe.fit_skill >= 0.6, `fit baixo demais: ${p.score_detalhe.fit_skill}`);
  assert.ok(p.score_base > 40, `score_base baixo: ${p.score_base}`);
});

test("scorer: budget ausente aplica penalidade", () => {
  const p = pontuar(vagaBase({ budget_min: null, budget_max: null, moeda: null }), perfil, pesos);
  assert.equal(p.score_detalhe.penalidades.budget_ausente, -4);
  assert.equal(p.score_detalhe.ticket, null);
});
