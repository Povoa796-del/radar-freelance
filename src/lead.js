// Lead de vendor: uma vaga da trilha EMPREGO cuja necessidade você resolve como serviço
// (conteúdo em escala, automação, pipeline de IA). Empresa com orçamento para o problema.
// Gera um rascunho de pitch em propostas/lead-<id>.md — para revisar, não para enviar.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizarTexto } from "./lib/jaccard.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROPOSTAS = join(RAIZ, "propostas");

const AREA_LABEL = { dev: "dev", ia: "IA/automação" };

// A necessidade casa uma das três linhas de serviço?
export function temaDeServico(texto) {
  const t = normalizarTexto(texto);
  const conteudoEscala = /(content|conteudo)/.test(t) && /(scale|escala|pipeline|generation|geracao|ops|volume|automation|automacao|marketing|strateg)/.test(t);
  const automacao = /\bautomat(e|ion|ing)\b|automacao|automatiza|workflow automation|process automation|\bn8n\b|\bzapier\b|\bmake com\b/.test(t);
  const pipelineIA = /\b(ai|ml|llm|rag|gpt|genai|generative)\b[\w\s]{0,20}\bpipeline\b|\bpipeline\b[\w\s]{0,20}\b(ai|ml|llm|rag|data|content|conteudo)\b|\bdata pipeline\b/.test(t);
  if (conteudoEscala) return "conteúdo em escala";
  if (pipelineIA) return "pipeline de IA";
  if (automacao) return "automação";
  return null;
}

// É lead? Trilha emprego + a LLM julgou viabilidade alta + a necessidade é uma linha de serviço.
export function ehLead(vaga) {
  if (vaga.score_detalhe?.trilha !== "emprego") return false;
  if (vaga.llm_analise?.viabilidade_agentes !== "alta") return false;
  return Boolean(temaDeServico(`${vaga.titulo} ${vaga.descricao || ""}`));
}

// Casos do perfil com mais sobreposição de stack/tipo com a vaga.
function casesRelevantes(vaga, perfil, n = 3) {
  const hay = normalizarTexto(`${vaga.titulo} ${vaga.descricao || ""} ${(vaga.skills || []).join(" ")}`);
  return (perfil.cases || [])
    .map((c) => {
      const termos = normalizarTexto(`${c.tipo} ${(c.stack || []).join(" ")}`).split(" ").filter((x) => x.length > 3);
      const overlap = termos.filter((x) => hay.includes(x)).length;
      return { c, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, n)
    .map((s) => s.c);
}

export function gerarPitch(vaga, perfil) {
  const a = vaga.llm_analise || {};
  const tema = temaDeServico(`${vaga.titulo} ${vaga.descricao || ""}`) || "o problema descrito";
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

## Ângulo: serviço, não head-count
Esta vaga descreve um problema de **${tema}** — entregável delimitado (código/conteúdo/dado),
não uma função que exige reuniões diárias. Em vez de contratar em tempo integral, a empresa
pode comprar o **resultado** como vendor: mais rápido, sem o custo de um salário fixo.

## Pitch (rascunho)
${perfil.posicionamento || ""}

Casos relevantes:
${linhasCases}

## Engajamento sugerido
- Projeto fixo a partir de **US$ ${pricing.fixo_usd_min ?? "?"}**, ou retainer **US$ ${pricing.retainer_usd_mes_min ?? "?"}/mês**.
- Esforço de referência (estimativa da LLM): ~${a.esforco_horas_estimado ?? "?"}h.
- Risco a validar antes: ${a.risco_principal || "—"}.

## Próximo passo
Revisar o tom, ajustar aos detalhes da empresa, e enviar como **proposta de vendor** — não como candidatura à vaga.

---
_Rascunho gerado automaticamente pelo radar. Revise antes de usar._
`;
}

// Escreve propostas/lead-<id>.md e retorna o caminho.
export function escreverPitch(vaga, perfil) {
  mkdirSync(PROPOSTAS, { recursive: true });
  const caminho = join(PROPOSTAS, `lead-${vaga.id}.md`);
  writeFileSync(caminho, gerarPitch(vaga, perfil));
  return caminho;
}
