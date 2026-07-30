// Testes das funções puras de apoio: moeda, jaccard, gate e scorer.
import { test } from "node:test";
import assert from "node:assert/strict";

import { paraUSD, detectarMoeda, moedaSuportada } from "../src/lib/moeda.js";
import { similaridade, shingles, normalizarTexto } from "../src/lib/jaccard.js";
import { montarVaga, urlCanonica, parseSalario } from "../src/lib/vaga.js";
import { avaliarGate } from "../src/agents/04-gate.js";
import { componentesDeterministicos, montarScore, trilhaDe } from "../src/agents/05-scorer.js";
import { formatarVaga } from "../src/agents/07-alerta.js";
import { decidirCliques } from "../src/callbacks.js";

const perfil = {
  pricing: { hora_usd_min: 45, fixo_usd_min: 800 },
  anti_stacks: ["Unity", "Salesforce"],
  fit_keywords: { automation: 1.0, llm: 1.0, node: 1.0, "next.js": 1.0 },
};
const pesos = {
  fit_skill: 35, viabilidade_agentes: 25, ticket: 15, qualidade_cliente: 15,
  frescor: 10, ticket_emprego_eur: { min: 55000, max: 110000 },
  penalidades: { budget_ausente: -4 },
};
const gateCfg = { moedas_aceitas: ["USD", "EUR", "GBP", "CHF"], max_dias_publicado: 7, fit_minimo: 0.45 };

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

test("scorer v2: componente sem dado sai do numerador E do denominador", () => {
  const semDados = { budget_min: null, budget_max: null, moeda: null, cliente_meta: {} };
  // freelance sem budget e sem metadata de cliente: só fit + frescor determinísticos.
  const det = componentesDeterministicos(vagaBase({ ...semDados, tipo: "freelance_fixo" }), perfil, pesos);
  assert.ok(det.componentes.fit_skill, "fit sempre presente");
  assert.equal(det.componentes.ticket, undefined, "ticket ausente sem budget");
  assert.equal(det.componentes.qualidade_cliente, undefined, "qualidade ausente sem metadata");
  assert.ok(det.componentes.frescor, "frescor presente (tem data)");
});

test("scorer v2: renormaliza sobre pesos aplicáveis (fit 1.0 + viab 1.0 + frescor 0.4 = 91)", () => {
  const det = { trilha: "freelance", componentes: {
    fit_skill: { peso: 35, valor: 1.0 },
    frescor: { peso: 10, valor: 0.4 },
  } };
  const { score, score_detalhe } = montarScore(det, 1.0, {}, pesos);
  // (35*1 + 25*1 + 10*0.4) / (35+25+10) * 100 = 64/70*100 = 91.43
  assert.equal(score, 91);
  assert.equal(score_detalhe.denominador, 70);
  assert.equal(score_detalhe.versao, 2);
  assert.deepEqual(Object.keys(score_detalhe.pesos_aplicados).sort(), ["fit_skill", "frescor", "viabilidade_agentes"]);
});

test("scorer v2: budget ausente NÃO gera penalidade (só some do denominador)", () => {
  const det = componentesDeterministicos(vagaBase({ budget_min: null, budget_max: null, moeda: null }), perfil, pesos);
  const { score_detalhe } = montarScore(det, 0.55, {}, pesos);
  assert.deepEqual(score_detalhe.penalidades, {});
  assert.equal(score_detalhe.ticket, undefined);
});

test("scorer v2: trilha e ticket próprio (emprego satura em EUR 110k)", () => {
  assert.equal(trilhaDe({ tipo: "emprego" }), "emprego");
  const det = componentesDeterministicos(
    vagaBase({ tipo: "emprego", budget_min: 130000, budget_max: 130000, moeda: "USD" }),
    perfil, pesos
  );
  assert.equal(det.trilha, "emprego");
  assert.equal(det.componentes.ticket.valor, 1); // 130k USD > 110k EUR (~118.8k) → satura
});

test("scorer v2: red flag do LLM entra como penalidade absoluta", () => {
  const pesosPen = { ...pesos, penalidades: { equity_ou_revshare: -40 } };
  const det = { trilha: "freelance", componentes: { fit_skill: { peso: 35, valor: 1.0 } } };
  const { score } = montarScore(det, 1.0, { equity_ou_revshare: -40 }, pesosPen);
  // (35+25)/(60)*100 = 100; -40 = 60
  assert.equal(score, 60);
});

test("callbacks: primeiro clique por vaga vence; repetido/conflito é logado", () => {
  const upd = (update_id, cbId, data) => ({ update_id, callback_query: { id: cbId, data, message: { chat: { id: 1 }, message_id: update_id } } });
  const updates = [
    upd(10, "c1", "int:A"),   // A -> interesse (primeiro)
    upd(11, "c2", "desc:A"),  // A -> conflito, mantém interesse
    upd(12, "c3", "int:B"),   // B -> interesse (primeiro)
    upd(13, "c4", "int:B"),   // B -> repetido, mantém interesse
    upd(14, "c5", "noop"),    // dado sem status válido
  ];
  const { acoes, conflitos, maxId } = decidirCliques(updates);

  const primeiros = acoes.filter((a) => a.tipo === "primeiro");
  assert.deepEqual(primeiros.map((a) => [a.id, a.status]), [["A", "interesse"], ["B", "interesse"]]);
  assert.equal(acoes.filter((a) => a.tipo === "repetido").length, 2);
  assert.equal(acoes.filter((a) => a.tipo === "noop").length, 1);
  assert.deepEqual(conflitos, [
    { id: "A", mantido: "interesse", ignorado: "descartado" },
    { id: "B", mantido: "interesse", ignorado: "interesse" },
  ]);
  assert.equal(maxId, 14);
});

test("alerta: sonda ganha marcação visual; item de alerta não", () => {
  const base = {
    score: 62, fonte: "himalayas", titulo: "AI Automation Engineer", empresa: "Acme",
    tipo: "freelance_fixo", budget_usd: null, publicado_em: new Date().toISOString(),
    llm_analise: { necessidade_real: "x", viabilidade_agentes: "alta" },
  };
  const sonda = formatarVaga({ ...base, score_detalhe: { banda: "sonda" } });
  assert.match(sonda, /🔬/);
  assert.match(sonda, /SONDA/);

  const alerta = formatarVaga({ ...base, score: 82, score_detalhe: { banda: "alerta" } });
  assert.match(alerta, /🎯/);
  assert.doesNotMatch(alerta, /SONDA/);
});

test("gate: fit abaixo do mínimo é descartado independente de salário", () => {
  const foraDoNicho = montarVaga({
    fonte: "t", fonte_id: "9", url: "https://ex.com/9",
    titulo: "Senior Salesforce Administrator", descricao: "Manage Salesforce org, reports and dashboards.",
    skills: [], tipo: "emprego", budget_min: 200000, budget_max: 200000, moeda: "USD",
    publicado_em: new Date().toISOString(), remoto: true,
  });
  const r = avaliarGate(foraDoNicho, perfil, gateCfg);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /fit/);
});
