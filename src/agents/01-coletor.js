// 01 — coletor. Roda todos os adapters habilitados. Falha em uma fonte NUNCA
// derruba o ciclo: try/catch por fonte + registro em fonte_saude.
import himalayas from "../sources/himalayas.js";
import remoteok from "../sources/remoteok.js";
import remotive from "../sources/remotive.js";
import jobicy from "../sources/jobicy.js";
import arbeitnow from "../sources/arbeitnow.js";
import hn from "../sources/hn-whoishiring.js";
import landingJobs from "../sources/landing-jobs.js";
import { registrarSaudeFonte } from "../lib/supabase.js";
import { log, warn } from "../lib/log.js";

export const ADAPTERS = {
  himalayas,
  remoteok,
  remotive,
  jobicy,
  arbeitnow,
  "hn-whoishiring": hn,
  "landing-jobs": landingJobs,
};

export async function coletar({ fontesCfg = {}, keywords = [], since = new Date(0) } = {}) {
  const coletas = [];
  for (const [nome, adapter] of Object.entries(ADAPTERS)) {
    const cfg = fontesCfg[nome] || {};
    if (cfg.enabled === false) {
      log(`fonte ${nome}: desabilitada, pulando`);
      continue;
    }
    try {
      const raws = await adapter.fetch({ config: cfg, keywords, since });
      log(`fonte ${nome}: ${raws.length} itens brutos`);
      coletas.push({ fonte: nome, adapter, raws });
      await gravarSaude(nome, { ok: true, itens: raws.length });
    } catch (err) {
      warn(`fonte ${nome} falhou: ${err.message}`);
      await gravarSaude(nome, { ok: false, erro: err.message });
    }
  }
  return coletas;
}

// A gravação de saúde não pode derrubar o ciclo se o Supabase oscilar.
async function gravarSaude(fonte, dados) {
  try {
    await registrarSaudeFonte(fonte, dados);
  } catch (err) {
    warn(`não consegui gravar fonte_saude de ${fonte}: ${err.message}`);
  }
}
