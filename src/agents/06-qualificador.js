// 06 — qualificador (LLM). Determinístico primeiro (05), LLM só no que pode chegar ao
// corte de alerta — assim uma run de 200 vagas custa centavos.
import { deepseek } from "../lib/llm.js";
import { log, warn } from "../lib/log.js";

const VIABILIDADE = { alta: 1.0, media: 0.55, baixa: 0.15 };

function perfilResumido(perfil) {
  return `${perfil.posicionamento}. Stacks fortes: ${(perfil.stacks_core || []).join(", ")}. Aceitáveis: ${(perfil.stacks_aceitaveis || []).join(", ")}.`;
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
  "red_flags": ["equity_ou_revshare","teste_nao_pago","escopo_vago","exige_fulltime"]
}`;
}

// Penalidades textuais baratas, independentes do LLM.
function penalidadesTexto(vaga, perfil, pesos) {
  const texto = `${vaga.titulo} ${vaga.descricao || ""}`.toLowerCase();
  const p = {};
  if (/\b(urgent|asap|immediately|urgente)\b/.test(texto) && vaga.budget_usd != null) {
    const min = perfil.pricing.fixo_usd_min || 800;
    if (vaga.budget_usd < 2 * min) p.urgente_com_budget_baixo = pesos.penalidades.urgente_com_budget_baixo;
  }
  if (/\bnda\b/.test(texto.slice(0, 300))) p.nda_antes_da_descricao = pesos.penalidades.nda_antes_da_descricao;
  return p;
}

function aplicarRedFlags(redFlags, pesos) {
  const p = {};
  for (const f of redFlags || []) {
    if (pesos.penalidades[f] != null) p[f] = pesos.penalidades[f];
  }
  return p;
}

// Executa fn sobre itens com concorrência limitada.
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

function finalizar(vaga, viabilidadeNorm, penalidades, pesos, llm_analise) {
  const somaPen = Object.values(penalidades).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.round(vaga.score_base + viabilidadeNorm * pesos.viabilidade_agentes + somaPen));
  return {
    ...vaga,
    score,
    score_detalhe: {
      ...vaga.score_detalhe,
      viabilidade_agentes: Number(viabilidadeNorm.toFixed(2)),
      penalidades: { ...vaga.score_detalhe.penalidades, ...penalidades },
    },
    llm_analise: llm_analise || null,
  };
}

export async function qualificar(vagas, perfil, pesos, { scoreMinimo = 70, maxAnalises = 40 } = {}) {
  // Só vale a pena analisar quem pode alcançar o corte mesmo com viabilidade máxima.
  // O fit mínimo já foi garantido no gate (04).
  const piso = scoreMinimo - pesos.viabilidade_agentes;
  const candidatas = vagas
    .filter((v) => v.score_base >= piso)
    .sort((a, b) => b.score_base - a.score_base)
    .slice(0, maxAnalises);
  const idsAnalisar = new Set(candidatas.map((v) => v.hash));
  log(`qualificador: ${candidatas.length}/${vagas.length} vão à LLM (piso score_base ${piso})`);

  const analisadas = await comPool(candidatas, 5, async (vaga) => {
    const penTexto = penalidadesTexto(vaga, perfil, pesos);
    try {
      const r = await deepseek(montarPrompt(vaga, perfil), { json: true, temperatura: 0 });
      const vNorm = VIABILIDADE[r.viabilidade_agentes] ?? 0.55;
      const pen = { ...penTexto, ...aplicarRedFlags(r.red_flags, pesos) };
      return finalizar(vaga, vNorm, pen, pesos, r);
    } catch (err) {
      warn(`LLM falhou na vaga "${vaga.titulo?.slice(0, 40)}": ${err.message}`);
      return finalizar(vaga, 0.55, penTexto, pesos, null); // neutro em caso de falha
    }
  });

  // Quem não foi à LLM: viabilidade neutra, sem red flags. Não deve alcançar o corte.
  const naoAnalisadas = vagas
    .filter((v) => !idsAnalisar.has(v.hash))
    .map((v) => finalizar(v, 0.55, {}, pesos, null));

  return [...analisadas, ...naoAnalisadas];
}
