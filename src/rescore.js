// Re-pontuação v2 das vagas já gravadas — evita misturar escalas incompatíveis no ranking.
// Reaproveita a viabilidade já armazenada em llm_analise (não gasta LLM de novo).
// Preserva status definido por humano (interesse/descartado/aplicado/…); só recomputa o número.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { todasVagas, atualizarScore } from "./lib/supabase.js";
import { componentesDeterministicos, montarScore } from "./agents/05-scorer.js";
import { penalidades as penalidadesDe } from "./agents/06-qualificador.js";
import { log } from "./lib/log.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = (n) => JSON.parse(readFileSync(join(RAIZ, "src/config", n), "utf8"));

const VIABILIDADE = { alta: 1.0, media: 0.55, baixa: 0.15 };
const STATUS_HUMANO = new Set(["interesse", "descartado", "aplicado", "resposta", "ganho", "perdido"]);

export async function repontuar() {
  const perfil = cfg("perfil.json");
  const pesos = cfg("pesos.json");
  const vagas = await todasVagas();
  log(`rescore: ${vagas.length} vagas na tabela`);

  let repontuadas = 0;
  let semDados = 0;
  for (const v of vagas) {
    const det = componentesDeterministicos(v, perfil, pesos);
    const viab = v.llm_analise?.viabilidade_agentes;
    const preservaStatus = STATUS_HUMANO.has(v.status);

    if (viab && VIABILIDADE[viab] != null) {
      const { score, score_detalhe } = montarScore(det, VIABILIDADE[viab], penalidadesDe(v, v.llm_analise, perfil, pesos), pesos);
      const patch = { score, score_detalhe };
      if (!preservaStatus) patch.status = "novo";
      await atualizarScore(v.id, patch);
      repontuadas++;
    } else {
      // Sem viabilidade armazenada → guarda-corpo v2: dados insuficientes.
      const valores = Object.fromEntries(Object.entries(det.componentes).map(([k, c]) => [k, Number(c.valor.toFixed(2))]));
      const patch = { score: null, score_detalhe: { versao: 2, trilha: det.trilha, motivo: "dados_insuficientes", ...valores } };
      if (!preservaStatus) patch.status = "descartado";
      await atualizarScore(v.id, patch);
      semDados++;
    }
  }
  log(`rescore: ${repontuadas} repontuadas (v2), ${semDados} marcadas dados_insuficientes`);
  return { repontuadas, semDados };
}
