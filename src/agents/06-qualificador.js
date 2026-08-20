// 06 — qualificador (LLM). O fit mínimo no gate (04) já limitou o volume, então TODAS as
// aprovadas vão à LLM: sem viabilidade não há score (guarda-corpo v2). Prioriza por fit
// e respeita um teto de análises por segurança de custo.
import { deepseek } from "../lib/llm.js";
import { componentesDeterministicos, montarScore } from "./05-scorer.js";
import { decidirIdioma } from "../lib/idioma.js";
import { log, warn } from "../lib/log.js";

const VIABILIDADE = { alta: 1.0, media: 0.55, baixa: 0.15 };

function perfilResumido(perfil) {
  const col = perfil.colaborador;
  const colTxt = col
    ? ` Trabalha com um colaborador técnico (recurso interno, não sócio — você é o ponto de` +
      ` contato e o arquiteto) que cobre: ${col.stacks.join("; ")}. Considere a CAPACIDADE` +
      ` COMBINADA dos dois na viabilidade, sem assumir que qualquer um dos dois executa` +
      ` pessoalmente toda a stack do outro.`
    : "";
  return `${perfil.posicionamento}. Stacks fortes: ${(perfil.stacks_core || []).join(", ")}. Aceitáveis: ${(perfil.stacks_aceitaveis || []).join(", ")}.${colTxt}`;
}

function montarPrompt(vaga, perfil) {
  return `Você analisa uma oportunidade de trabalho para um engenheiro de automação com IA.
Perfil: ${perfilResumido(perfil)}
Vaga:
Título: ${vaga.titulo}
Descrição: ${(vaga.descricao || "").slice(0, 4000)}

Responda APENAS com JSON, sem markdown:
{
  "necessidade_real": "1 frase: o que o cliente de fato precisa",
  "viabilidade_agentes": "alta|media|baixa",
  "justificativa_viabilidade": "1 frase",
  "esforco_horas_estimado": number,
  "risco_principal": "1 frase",
  "red_flags": ["equity_ou_revshare","teste_nao_pago","escopo_vago","exige_fulltime"],
  "idioma_modalidade": "escrito|falado|ambos",
  "interlocutor_falado": "cliente|interno|nenhum",
  "tipo_de_necessidade": "producao_em_escala|funcao_individual",
  "justificativa_necessidade": "1 frase"
}

Definições:
- idioma_modalidade: 'falado' se exige falar inglês (entrevista de contratação, calls, daily,
  suporte ao vivo, native English speaker); 'escrito' se só exige inglês escrito (entrega
  assíncrona, briefing por texto, sem reunião recorrente); 'ambos' se exige os dois.
- interlocutor_falado: só relevante se idioma_modalidade for 'falado' ou 'ambos'. 'cliente' se
  a fala é COM O CLIENTE FINAL (account management, liderar calls com cliente, treinamento ou
  mentoria ao vivo, apresentação para cliente — falar inglês é parte do produto entregue);
  'interno' se é só alinhamento com o time (standup, weekly, sync técnico — falar inglês é só
  para trabalhar com o time, não o entregável); 'nenhum' se idioma_modalidade for 'escrito'.
- tipo_de_necessidade: 'producao_em_escala' se a empresa contrata para um PROBLEMA de produção
  em escala entregável como sistema (conteúdo em volume, automação de processo, pipeline de
  dados ou de IA — "produzir X em escala usando IA"); 'funcao_individual' se querem uma PESSOA
  para senioridade/execução (dev, designer, PM, analista), não uma máquina.`;
}

// Penalidades (SEM budget_ausente — removida na v2): texto + red flags do LLM + qualidade
// do cliente (hire_rate / média paga — só quando a fonte traz o dado em cliente_meta;
// nenhum adapter atual popula isso ainda, mas fica pronto para quando a Fase 2/Upwork trouxer).
export function penalidades(vaga, llm, perfil, pesos) {
  const texto = `${vaga.titulo} ${vaga.descricao || ""}`.toLowerCase();
  const pen = pesos.penalidades || {};
  const p = {};
  if (/\b(urgent|asap|immediately|urgente)\b/.test(texto) && vaga.budget_usd != null) {
    const min = perfil.pricing.fixo_usd_min || 800;
    if (vaga.budget_usd < 2 * min && pen.urgente_com_budget_baixo) p.urgente_com_budget_baixo = pen.urgente_com_budget_baixo;
  }
  if (/\bnda\b/.test(texto.slice(0, 300)) && pen.nda_antes_da_descricao) p.nda_antes_da_descricao = pen.nda_antes_da_descricao;
  const cm = vaga.cliente_meta || {};
  if (typeof cm.hire_rate === "number" && cm.hire_rate < 0.3 && pen.cliente_hire_rate_baixo) {
    p.cliente_hire_rate_baixo = pen.cliente_hire_rate_baixo;
  }
  if (typeof cm.media_paga_usd_h === "number" && cm.media_paga_usd_h < 12 && pen.cliente_paga_baixa) {
    p.cliente_paga_baixa = pen.cliente_paga_baixa;
  }
  for (const f of llm?.red_flags || []) if (pen[f] != null) p[f] = pen[f];
  return p;
}

async function comPool(itens, limite, fn) {
  const resultado = [];
  let i = 0;
  async function trabalhador() {
    while (i < itens.length) {
      const idx = i++;
      resultado[idx] = await fn(itens[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultado;
}

// Sem viabilidade não pontua: guarda-corpo v2 (item 3 da spec).
function descartar(vaga, det, motivo) {
  const valores = Object.fromEntries(
    Object.entries(det.componentes).map(([k, c]) => [k, Number(c.valor.toFixed(2))])
  );
  return {
    ...vaga,
    score: null,
    status: "descartado",
    score_detalhe: { versao: 2, trilha: det.trilha, motivo, ...valores },
    llm_analise: null,
  };
}

export async function qualificar(vagas, perfil, pesos, { maxAnalises = 40 } = {}) {
  const comDet = vagas.map((v) => ({ v, det: componentesDeterministicos(v, perfil, pesos) }));
  comDet.sort((a, b) => b.det.componentes.fit_skill.valor - a.det.componentes.fit_skill.valor);
  const analisar = comDet.slice(0, maxAnalises);
  const excedente = comDet.slice(maxAnalises);
  log(`qualificador: ${analisar.length} à LLM${excedente.length ? ` (+${excedente.length} acima do teto → descartadas)` : ""}`);

  const pontuadas = await comPool(analisar, 5, async ({ v, det }) => {
    try {
      const r = await deepseek(montarPrompt(v, perfil), { json: true, temperatura: 0 });
      const vNorm = VIABILIDADE[r.viabilidade_agentes] ?? 0.55;
      const { score, score_detalhe } = montarScore(det, vNorm, penalidades(v, r, perfil, pesos), pesos);

      // Gate por modalidade de idioma (pós-LLM: precisa de idioma_modalidade + score).
      const idi = decidirIdioma(v, r, score);
      if (idi.rejeitar) {
        return { ...v, score, status: "descartado", score_detalhe: { ...score_detalhe, motivo: idi.motivo }, llm_analise: r };
      }
      score_detalhe.entrega_ingles = idi.entrega_ingles;
      score_detalhe.mercado = idi.mercado;
      score_detalhe.lead_ingles = idi.lead_ingles;
      score_detalhe.fala_interna = idi.fala_interna;
      return { ...v, score, score_detalhe, llm_analise: r, status: "novo" };
    } catch (err) {
      warn(`LLM falhou em "${v.titulo?.slice(0, 40)}": ${err.message}`);
      return descartar(v, det, "dados_insuficientes"); // sem viabilidade → não pontua
    }
  });

  const descartadas = excedente.map(({ v, det }) => descartar(v, det, "dados_insuficientes"));
  return [...pontuadas, ...descartadas];
}
