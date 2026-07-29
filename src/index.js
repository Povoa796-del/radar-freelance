// Orquestrador. Uso:
//   node src/index.js --ciclo    → um ciclo completo (coleta → alerta)
//   node src/index.js --digest   → relatório semanal
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { coletar } from "./agents/01-coletor.js";
import { normalizar } from "./agents/02-normalizador.js";
import { deduplicar } from "./agents/03-dedupe.js";
import { filtrarGate } from "./agents/04-gate.js";
import { pontuarLote } from "./agents/05-scorer.js";
import { qualificar } from "./agents/06-qualificador.js";
import { alertar } from "./agents/07-alerta.js";
import { inserirVagas } from "./lib/supabase.js";
import { gerarDigest } from "./digest.js";
import { log, erro } from "./lib/log.js";

// Carrega .env em dev; em CI as variáveis já vêm do ambiente (secrets).
try {
  process.loadEnvFile();
} catch {
  /* sem .env: usa process.env do ambiente */
}

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = (nome) => JSON.parse(readFileSync(join(RAIZ, "src/config", nome), "utf8"));

async function ciclo() {
  const perfil = cfg("perfil.json");
  const pesos = cfg("pesos.json");
  const fontes = cfg("fontes.json");
  const t0 = Date.now();

  const coletas = await coletar({ fontesCfg: fontes.fontes, keywords: fontes.keywords });
  const vagas = normalizar(coletas);
  log(`normalizador: ${vagas.length} vagas`);

  const novas = await deduplicar(vagas);
  const { aprovadas, motivos } = filtrarGate(novas, perfil, fontes.gate);
  if (Object.keys(motivos).length) log("gate motivos:", JSON.stringify(motivos));

  const pontuadas = pontuarLote(aprovadas, perfil, pesos);
  const finais = await qualificar(pontuadas, perfil, pesos, {
    scoreMinimo: fontes.alerta.score_minimo,
    maxAnalises: fontes.alerta.max_analises ?? 40,
  });

  const inseridas = await inserirVagas(finais);
  log(`persistência: ${inseridas.length} vagas gravadas`);

  const res = await alertar({
    scoreMinimo: fontes.alerta.score_minimo,
    maxOportunidades: fontes.alerta.max_oportunidades,
  });

  log(`ciclo concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s · alertadas: ${res.enviadas}`);
}

async function main() {
  const modo = process.argv[2];
  if (modo === "--digest") {
    await gerarDigest();
  } else if (modo === "--ciclo") {
    await ciclo();
  } else {
    console.log("Uso: node src/index.js --ciclo | --digest");
    process.exit(1);
  }
}

main().catch((e) => {
  erro(e.stack || e.message);
  process.exit(1);
});
