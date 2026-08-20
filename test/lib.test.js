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
import { avaliarGeo } from "../src/lib/geo.js";
import { ehLead, temaDeServico, gerarPitch } from "../src/lead.js";
import { decidirIdioma, lusoHispano } from "../src/lib/idioma.js";
import { pareceNaoVaga } from "../src/lib/validacao.js";
import { penalidades } from "../src/agents/06-qualificador.js";

const geoAtivo = {
  aceita_presencial: true,
  zonas: {
    z0: { cidades: ["Vigo"], provincias: [] },
    z1: { cidades: ["Braga", "Pontevedra", "Viana do Castelo"], provincias: ["Pontevedra", "Braga"] },
    z2: { cidades: ["Porto"], provincias: ["Porto"] },
  },
};

const perfil = {
  pricing: { hora_usd_min: 45, fixo_usd_min: 800 },
  anti_stacks: ["Unity", "Salesforce", "n8n"],
  fit_keywords: { automation: 1.0, llm: 1.0, node: 1.0, "next.js": 1.0, python: 0.8, rag: 1.0 },
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

test("vaga: skills não-array não quebra (coage para array)", () => {
  const v = montarVaga({ fonte: "t", fonte_id: "1", url: "https://x.com/1", titulo: "T", skills: "solo" });
  assert.deepEqual(v.skills, ["solo"]);
  const v2 = montarVaga({ fonte: "t", fonte_id: "2", url: "https://x.com/2", titulo: "T", skills: { a: 1 } });
  assert.ok(Array.isArray(v2.skills));
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

// --- Colaborador: stack complementar sai do descarte e passa a pontuar (item 1) ---

test("gate: Python + RAG (stack do colaborador) passa — antes era anti-stack/baixo fit", () => {
  const v = vagaBase({
    titulo: "AI Automation Engineer (Python, RAG)",
    descricao: "Build a RAG pipeline in Python with vector database and automation.",
    skills: ["python", "rag"],
  });
  assert.equal(avaliarGate(v, perfil, gateCfg).ok, true);
});

test("gate: n8n continua anti-stack (nenhum dos dois cobre)", () => {
  const v = vagaBase({
    titulo: "Automation Engineer — n8n workflows",
    descricao: "Build automation with n8n and LLM integration.",
  });
  const r = avaliarGate(v, perfil, gateCfg);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /anti-stack: n8n/i);
});

// --- Idioma: disponibilidade de horário não bloqueia; vídeo e fala-com-cliente sim (item 3) ---

test("gate: overlap de fuso / frequência de reunião NÃO bloqueia mais", () => {
  const v = vagaBase({ descricao: "Must overlap with PST for at least 8 hours daily. Automation and LLM work." });
  const r = avaliarGate(v, perfil, gateCfg);
  assert.notEqual(r.motivo, "exige overlap de fuso grande");
  assert.equal(r.ok, true);
});

test("gate: vídeo obrigatório na candidatura (Loom) é descartado", () => {
  const v = vagaBase({ descricao: "Please record a Loom video introducing yourself as part of your application." });
  const r = avaliarGate(v, perfil, gateCfg);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "video_obrigatorio");
});

test("gate: núcleo falado com cliente (account manager / lead client calls) é descartado no anglófono", () => {
  const v = vagaBase({
    titulo: "Account Manager — Automation Platform",
    descricao: "You will lead client calls for our automation platform and manage relationships with LLM-powered clients.",
  });
  const r = avaliarGate(v, perfil, gateCfg);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "ingles_falado_cliente");
});

test("gate: a mesma frase em mercado luso-hispano NÃO é descartada por ingles_falado_cliente", () => {
  const v = vagaBase({
    titulo: "Account Manager — Automation Platform",
    descricao: "Lead client calls for our Brazil automation office. Fluent Portuguese required.",
    cliente_meta: { locations: [{ country_code: "BR" }] },
  });
  const r = avaliarGate(v, perfil, gateCfg);
  assert.notEqual(r.motivo, "ingles_falado_cliente");
});

test("idioma: reunião interna (standup/weekly) não rejeita — marca fala_interna", () => {
  const v = vagaBase();
  const llm = { idioma_modalidade: "falado", interlocutor_falado: "interno", tipo_de_necessidade: "producao_em_escala" };
  const r = decidirIdioma(v, llm, 75);
  assert.equal(r.rejeitar, false);
  assert.equal(r.fala_interna, true);
});

test("idioma: falar inglês COM O CLIENTE rejeita mesmo com score alto", () => {
  const v = vagaBase();
  const llm = { idioma_modalidade: "falado", interlocutor_falado: "cliente", tipo_de_necessidade: "producao_em_escala" };
  const r = decidirIdioma(v, llm, 90);
  assert.equal(r.rejeitar, true);
  assert.equal(r.motivo, "ingles_falado");
  assert.equal(r.fala_interna, false);
});

// --- Filtros de qualidade (item 4) ---

test("gate: preço fixo baixo + escopo desproporcional (proxy >3 entregas) é descartado", () => {
  const desc = [
    "We need the following deliverables:",
    "1. Landing page design",
    "2. Backend API",
    "3. Database schema",
    "4. Admin dashboard",
    "5. Deployment and docs",
  ].join("\n");
  const v = vagaBase({ tipo: "freelance_fixo", budget_min: 150, budget_max: 150, descricao: desc });
  const r = avaliarGate(v, perfil, gateCfg);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "escopo_desproporcional");
});

test("gate: preço fixo baixo com poucas entregas NÃO é descartado por escopo", () => {
  const v = vagaBase({ tipo: "freelance_fixo", budget_min: 150, budget_max: 150, descricao: "1. Fix the bug." });
  const r = avaliarGate(v, perfil, gateCfg);
  assert.notEqual(r.motivo, "escopo_desproporcional");
});

test("gate: cliente com gasto total abaixo de $500 é descartado", () => {
  const v = vagaBase({ cliente_meta: { total_gasto_usd: 200 } });
  const r = avaliarGate(v, perfil, gateCfg);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "cliente_sem_historico");
});

test("gate: cliente com zero avaliações é descartado; ausência de dado NÃO penaliza", () => {
  assert.equal(avaliarGate(vagaBase({ cliente_meta: { avaliacoes: 0 } }), perfil, gateCfg).motivo, "cliente_sem_historico");
  assert.equal(avaliarGate(vagaBase(), perfil, gateCfg).ok, true);
});

test("gate: indicador de posição já preenchida (Hires: 1) é descartado", () => {
  const v = vagaBase({ descricao: "Great opportunity, apply now. Hires: 1." });
  const r = avaliarGate(v, perfil, gateCfg);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "posicao_preenchida");
});

test("gate: equipe exigida explicitamente é descartada", () => {
  assert.equal(avaliarGate(vagaBase({ titulo: "Automation Dev (Team)" }), perfil, gateCfg).motivo, "exige_equipe");
  assert.equal(
    avaliarGate(vagaBase({ descricao: "This role is team required, not for solo freelancers." }), perfil, gateCfg).motivo,
    "exige_equipe"
  );
});

test("qualificador: cliente hire_rate<30% ou paga<$12/h penaliza, não descarta; sem dado não penaliza", () => {
  const pesosComPen = { ...pesos, penalidades: { cliente_hire_rate_baixo: -20, cliente_paga_baixa: -20 } };
  const p1 = penalidades(vagaBase({ cliente_meta: { hire_rate: 0.2 } }), {}, perfil, pesosComPen);
  assert.equal(p1.cliente_hire_rate_baixo, -20);

  const p2 = penalidades(vagaBase({ cliente_meta: { media_paga_usd_h: 8 } }), {}, perfil, pesosComPen);
  assert.equal(p2.cliente_paga_baixa, -20);

  const p3 = penalidades(vagaBase(), {}, perfil, pesosComPen);
  assert.equal(p3.cliente_hire_rate_baixo, undefined);
  assert.equal(p3.cliente_paga_baixa, undefined);
});

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

test("geo: remoto não é presencial (sem zona)", () => {
  const r = avaliarGeo({ titulo: "Remote Node Engineer", descricao: "fully remote role", remoto: true }, geoAtivo);
  assert.equal(r.presencial, false);
  assert.equal(r.modalidade, "remoto");
  assert.equal(r.zona, null);
});

test("geo: híbrido em Braga → z1", () => {
  const r = avaliarGeo({ titulo: "Engineer (Hybrid)", descricao: "hybrid role", remoto: false, cliente_meta: { location: "Braga, Portugal" } }, geoAtivo);
  assert.equal(r.presencial, true);
  assert.equal(r.modalidade, "híbrido");
  assert.equal(r.zona, "z1");
  assert.equal(r.local, "Braga");
});

test("geo precedência: Vigo casa z0-cidade E z1-província → cidade ganha (z0)", () => {
  const geo = {
    aceita_presencial: true,
    zonas: {
      z0: { cidades: ["Vigo"], provincias: [] },
      z1: { cidades: [], provincias: ["Pontevedra"] },
    },
  };
  const r = avaliarGeo({ titulo: "On-site Dev", descricao: "on-site", remoto: false, cliente_meta: { location: "Vigo, Pontevedra, Spain" } }, geo);
  assert.equal(r.zona, "z0");
  assert.equal(r.local, "Vigo");
});

test("geo precedência: Monção casa z0-cidade E z1-província → cidade ganha (z0)", () => {
  // Monção fica na província de Viana do Castelo (z1), mas está listada como cidade em z0.
  const geo = {
    aceita_presencial: true,
    zonas: {
      z0: { cidades: ["Vigo", "Monção"], provincias: [] },
      z1: { cidades: [], provincias: ["Viana do Castelo"] },
    },
  };
  const r = avaliarGeo({ titulo: "Hybrid Dev", descricao: "hybrid", remoto: false, cliente_meta: { location: "Monção, Viana do Castelo, Portugal" } }, geo);
  assert.equal(r.zona, "z0"); // cidade (z0) vence a província (z1)
  assert.equal(r.local, "Monção");
});

test("geo: presencial fora das zonas → zona null", () => {
  const r = avaliarGeo({ titulo: "On-site Engineer", descricao: "on-site in Madrid", remoto: false, cliente_meta: { location: "Madrid" } }, geoAtivo);
  assert.equal(r.presencial, true);
  assert.equal(r.zona, null);
});

test("gate geo: aceita_presencial=false mantém comportamento antigo", () => {
  const perfilOff = { ...perfil, geo: { aceita_presencial: false, zonas: geoAtivo.zonas } };
  const vagaPres = vagaBase({ remoto: false, descricao: "on-site role in Braga", cliente_meta: { location: "Braga" } });
  const r = avaliarGate(vagaPres, perfilOff, gateCfg);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /presença física/);
});

test("gate geo: ativo → em zona passa; fora de zona = fora_de_zona; remoto passa", () => {
  const perfilOn = { ...perfil, geo: geoAtivo };
  const emZona = vagaBase({ remoto: false, descricao: "hybrid in Braga", cliente_meta: { location: "Braga" } });
  assert.equal(avaliarGate(emZona, perfilOn, gateCfg).ok, true);
  const foraZona = vagaBase({ remoto: false, descricao: "on-site in Madrid", cliente_meta: { location: "Madrid" } });
  assert.equal(avaliarGate(foraZona, perfilOn, gateCfg).motivo, "fora_de_zona");
  const remota = vagaBase({ remoto: true });
  assert.equal(avaliarGate(remota, perfilOn, gateCfg).ok, true);
});

test("alerta: linha 📍 só aparece para presencial/híbrido com zona", () => {
  const base = { score: 78, fonte: "adzuna", titulo: "AI Engineer", empresa: "X", tipo: "emprego", budget_usd: 90000, publicado_em: new Date().toISOString(), llm_analise: { viabilidade_agentes: "alta" } };
  const pres = formatarVaga({ ...base, score_detalhe: { zona: "z1_hibrido", local: "Braga", modalidade: "híbrido" } });
  assert.match(pres, /📍 Braga · z1_hibrido · híbrido/);
  const remota = formatarVaga({ ...base, score_detalhe: { zona: null, modalidade: "remoto" } });
  assert.doesNotMatch(remota, /📍/);
});

const leadVaga = {
  titulo: "Content Automation Manager",
  descricao: "Build a content pipeline at scale using automation and LLMs.",
  score: 78, fonte: "adzuna", empresa: "Acme", url: "https://x/y", skills: ["automation", "llm"],
  score_detalhe: { trilha: "emprego" },
  llm_analise: { viabilidade_agentes: "alta", tipo_de_necessidade: "producao_em_escala", necessidade_real: "Escalar produção de conteúdo", esforco_horas_estimado: 80, risco_principal: "escopo vago" },
};

test("lead: emprego + tipo_de_necessidade producao_em_escala → é lead", () => {
  assert.equal(ehLead(leadVaga), true);
  assert.ok(temaDeServico(leadVaga.descricao));
});

test("lead: freelance, funcao_individual ou sem classificação → NÃO é lead", () => {
  assert.equal(ehLead({ ...leadVaga, score_detalhe: { trilha: "freelance" } }), false);
  assert.equal(ehLead({ ...leadVaga, llm_analise: { tipo_de_necessidade: "funcao_individual" } }), false);
  assert.equal(ehLead({ ...leadVaga, llm_analise: {} }), false);
});

test("idioma: luso-hispano passa; anglófono falado rejeita; escrito vira 🔤", () => {
  const luso = { tipo: "emprego", cliente_meta: { locations: [{ country_code: "ES" }] }, score_detalhe: { trilha: "emprego" } };
  assert.equal(decidirIdioma(luso, { idioma_modalidade: "falado" }, 80).rejeitar, false);

  const falado = { tipo: "emprego", titulo: "Support Engineer", descricao: "daily calls", score_detalhe: { trilha: "emprego" } };
  assert.equal(decidirIdioma(falado, { idioma_modalidade: "falado" }, 80).motivo, "ingles_falado");

  const freelanceEscrito = { tipo: "freelance_fixo", titulo: "Technical writer", descricao: "async docs", score_detalhe: { trilha: "freelance" } };
  const rf = decidirIdioma(freelanceEscrito, { idioma_modalidade: "escrito" }, 80);
  assert.equal(rf.rejeitar, false);
  assert.equal(rf.entrega_ingles, true);
});

test("idioma: emprego anglófono só vira lead 🔤 se producao_em_escala e score≥60", () => {
  const base = { tipo: "emprego", titulo: "Content Ops", descricao: "scale content with AI", score_detalhe: { trilha: "emprego" } };
  const lead = decidirIdioma(base, { idioma_modalidade: "escrito", tipo_de_necessidade: "producao_em_escala" }, 72);
  assert.equal(lead.rejeitar, false);
  assert.equal(lead.entrega_ingles, true);
  assert.equal(lead.lead_ingles, true);
  // funcao_individual → rejeita
  assert.equal(decidirIdioma(base, { idioma_modalidade: "escrito", tipo_de_necessidade: "funcao_individual" }, 72).motivo, "ingles_falado");
  // producao_em_escala mas score < 60 → rejeita
  assert.equal(decidirIdioma(base, { idioma_modalidade: "escrito", tipo_de_necessidade: "producao_em_escala" }, 55).motivo, "ingles_falado");
});

test("lead: pitch tem necessidade, casos e engajamento", () => {
  const perfil = { posicionamento: "Eng de automação com IA", pricing: { fixo_usd_min: 800, retainer_usd_mes_min: 1500 }, cases: [{ nome: "Xadrez", tipo: "pipeline de vídeo", stack: ["Node.js", "DeepSeek"], resultado: "8 agentes" }] };
  const md = gerarPitch(leadVaga, perfil);
  assert.match(md, /Lead — Content Automation Manager/);
  assert.match(md, /Escalar produção de conteúdo/);
  assert.match(md, /Engajamento sugerido/);
  assert.match(md, /US\$ 800/);
});

test("validacao: página de marketing sem estrutura de posting = não-vaga", () => {
  const naoVaga = {
    titulo: "AGC Studio",
    descricao: "Our AI-powered platform is an all-in-one tool. Unlike generic solutions, the platform generates content at scale. Start your free trial today.",
  };
  assert.equal(pareceNaoVaga(naoVaga), true);

  const vagaReal = {
    titulo: "Senior Engineer",
    descricao: "We are looking for an engineer. Key responsibilities: build the AI-powered platform. Requirements: 5 years of experience. How to apply: send your CV.",
  };
  assert.equal(pareceNaoVaga(vagaReal), false); // tem estrutura de posting

  // vaga esparsa (HN) sem marketing NÃO é falso-positivo
  assert.equal(pareceNaoVaga({ titulo: "Node dev", descricao: "Build a scraper for us." }), false);
});

test("gate: descarta não-vaga com motivo 'nao_vaga'", () => {
  const naoVaga = vagaBase({ titulo: "Jasper", descricao: "Our AI-powered platform. Unlike generic tools. Free trial. Terms of service." });
  const r = avaliarGate(naoVaga, perfil, gateCfg);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "nao_vaga");
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
