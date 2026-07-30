// Leads de vendor e rascunhos de proposta.
// Lead = vaga emprego cuja necessidade é PRODUÇÃO EM ESCALA (entrega como sistema).
// Pitch em português (template) para cliente luso-hispano; em inglês (redator + revisor
// de localização) para o mercado anglófono com entrega escrita (🔤). Teto: 1 pitch em inglês.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizarTexto } from "./lib/jaccard.js";
import { deepseek } from "./lib/llm.js";
import { log, warn } from "./lib/log.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROPOSTAS = join(RAIZ, "propostas");

// Tema de serviço (para nomear no pitch). Detecção fina fica no LLM (tipo_de_necessidade).
export function temaDeServico(texto) {
  const t = normalizarTexto(texto);
  if (/(content|conteudo)/.test(t) && /(scale|escala|pipeline|generation|geracao|ops|volume|marketing)/.test(t)) return "conteúdo em escala";
  if (/\b(ai|ml|llm|rag|gpt|genai)\b[\w\s]{0,20}\bpipeline\b|\bdata pipeline\b/.test(t)) return "pipeline de IA/dados";
  if (/\bautomat(e|ion|ing)\b|automacao|workflow automation|process automation/.test(t)) return "automação de processo";
  return null;
}

// É lead? Trilha emprego + o LLM classificou a necessidade como produção em escala.
export function ehLead(vaga) {
  if (vaga.score_detalhe?.trilha !== "emprego") return false;
  return vaga.llm_analise?.tipo_de_necessidade === "producao_em_escala";
}

function casesRelevantes(vaga, perfil, n = 3) {
  const hay = normalizarTexto(`${vaga.titulo} ${vaga.descricao || ""} ${(vaga.skills || []).join(" ")}`);
  return (perfil.cases || [])
    .map((c) => {
      const termos = normalizarTexto(`${c.tipo} ${(c.stack || []).join(" ")}`).split(" ").filter((x) => x.length > 3);
      return { c, overlap: termos.filter((x) => hay.includes(x)).length };
    })
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, n)
    .map((s) => s.c);
}

// --- Pitch em português (template, cliente luso-hispano) ---
export function gerarPitch(vaga, perfil) {
  const a = vaga.llm_analise || {};
  const tema = temaDeServico(`${vaga.titulo} ${vaga.descricao || ""}`) || "produção em escala";
  const pricing = perfil.pricing || {};
  const cases = casesRelevantes(vaga, perfil);
  const linhasCases = cases.length
    ? cases.map((c) => `- **${c.nome}** (${c.tipo}) — ${c.resultado}${c.stack ? ` \`[${c.stack.join(", ")}]\`` : ""}`).join("\n")
    : "- (nenhum case casado — revisar manualmente)";

  return `# Lead — ${vaga.titulo}

**Empresa:** ${vaga.empresa || "—"} · **Fonte:** ${vaga.fonte || "—"} · **Score:** ${vaga.score ?? "—"} · **Tema:** ${tema}
${vaga.url || ""}

## A necessidade (o que eles descreveram)
${a.necessidade_real || (vaga.descricao || "").slice(0, 300)}
${a.justificativa_necessidade ? `\n_Por que é produção em escala:_ ${a.justificativa_necessidade}` : ""}

## Ângulo: serviço, não head-count
Problema de **${tema}** — entregável delimitado, você entrega como **sistema**. Em vez de
contratar em tempo integral, a empresa compra o **resultado** como vendor.

## Pitch (rascunho)
${perfil.posicionamento || ""}

Casos relevantes:
${linhasCases}

## Engajamento sugerido
- Projeto fixo a partir de **US$ ${pricing.fixo_usd_min ?? "?"}**, ou retainer **US$ ${pricing.retainer_usd_mes_min ?? "?"}/mês**.
- Esforço de referência (LLM): ~${a.esforco_horas_estimado ?? "?"}h · Risco: ${a.risco_principal || "—"}.

## Próximo passo
Revisar o tom, ajustar à empresa, enviar como **proposta de vendor**.

---
_Rascunho gerado automaticamente. Revise antes de usar._
`;
}

function escrever(vaga, conteudo, sufixo = "") {
  mkdirSync(PROPOSTAS, { recursive: true });
  const caminho = join(PROPOSTAS, `lead-${vaga.id}${sufixo}.md`);
  writeFileSync(caminho, conteudo);
  return caminho;
}

// --- Pitch em inglês: redator + revisor de localização (en-US) ---
export async function gerarPitchIngles(vaga, perfil) {
  const a = vaga.llm_analise || {};
  const cases = casesRelevantes(vaga, perfil)
    .map((c) => `- ${c.nome} (${c.tipo}): ${c.resultado} [${(c.stack || []).join(", ")}]`)
    .join("\n");
  const pricing = perfil.pricing || {};

  const promptRedator = `You are a freelance vendor writing a short outreach pitch in English (en-US) to a company that posted this role. Reframe it: they can buy the OUTCOME delivered as a system, not hire a full-time headcount. The engagement is written and asynchronous — do not claim availability for calls or meetings.

Company need: ${a.necessidade_real || vaga.titulo}
Sender positioning: ${perfil.posicionamento || ""}
Relevant case studies:
${cases}
Engagement: fixed project from US$ ${pricing.fixo_usd_min ?? "?"}, or retainer US$ ${pricing.retainer_usd_mes_min ?? "?"}/month.

Write 150-210 words, plain text (no markdown headings): a warm opener, the reframe, 2 concrete proof points from the cases, and a soft call to action.`;
  const rascunho = await deepseek(promptRedator, { temperatura: 0.4 });

  const promptRevisor = `You are a localization reviewer for en-US business English. Rewrite the text to fix register (professional, warm, confident but not salesy), remove any non-native idioms or awkward phrasing, and enforce consistent en-US spelling and idiom. Keep it concise. Return ONLY the revised text, nothing else.

Text:
${rascunho}`;
  const revisado = await deepseek(promptRevisor, { temperatura: 0.2 });

  return `# Lead 🔤 (EN) — ${vaga.titulo}

**Company:** ${vaga.empresa || "—"} · **Source:** ${vaga.fonte || "—"} · **Score:** ${vaga.score ?? "—"}
${vaga.url || ""}
_Need:_ ${a.necessidade_real || ""}

## Pitch (en-US, reviewed)
${revisado}

---
_Written by the radar (writer + en-US localization reviewer). Review before sending._

<details><summary>writer draft (pre-review)</summary>

${rascunho}
</details>
`;
}

// Orquestra os rascunhos de um alerta: templates PT para leads luso-hispano +
// no máximo 1 pitch em inglês (o 🔤 de maior score ≥ 60).
export async function gerarPropostas(vagas, perfil) {
  const escritos = [];

  for (const v of vagas) {
    if (ehLead(v) && !v.score_detalhe?.entrega_ingles) {
      try {
        escritos.push(escrever(v, gerarPitch(v, perfil)));
      } catch (err) {
        warn(`lead: falha no pitch PT de "${v.titulo?.slice(0, 40)}": ${err.message}`);
      }
    }
  }

  const alvo = vagas
    .filter((v) => v.score_detalhe?.entrega_ingles && (v.score ?? 0) >= 60)
    .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  if (alvo) {
    try {
      escritos.push(escrever(alvo, await gerarPitchIngles(alvo, perfil), "-en"));
    } catch (err) {
      warn(`lead: falha no pitch EN de "${alvo.titulo?.slice(0, 40)}": ${err.message}`);
    }
  }

  for (const c of escritos) log(`lead: pitch gravado em ${c}`);
  return escritos;
}
