// Radar Local Vigo — pipeline SEPARADO do radar remoto/tech.
// coleta (adzuna-local) → normaliza → dedupe (vagas_local) → score-local → alerta.
// Uso: node src/index.js --local
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import adzunaLocal from "./sources/adzuna-local.js";
import { pontuarLocal } from "./lib/score-local.js";
import {
  inserirVagasLocal,
  hashesLocalRecentes,
  candidatasLocal,
  marcarStatusLocal,
} from "./lib/supabase.js";
import { enviarMensagem, esc, telegramConfigurado } from "./lib/telegram.js";
import { log, warn } from "./lib/log.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const perfil = JSON.parse(readFileSync(join(RAIZ, "src/config/perfil-local.json"), "utf8"));

const FONTES = [adzunaLocal];

function idade(iso) {
  if (!iso) return "";
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 24) return `há ${Math.round(h)}h`;
  return `há ${Math.round(h / 24)}d`;
}

export function formatarLocal(v, sonda = false) {
  const linhas = [];
  if (sonda) linhas.push("🔬 <b>SONDA — abaixo do corte, me diz se presta</b>");
  linhas.push(`${sonda ? "🔬" : "🎯"} <b>${v.score} · ${esc(v.fonte)}</b>`);
  linhas.push(esc(v.titulo));

  const loc = [];
  if (v.local) loc.push(`📍 ${esc(v.local)}`);
  const zdist = [v.distancia_km != null ? `~${v.distancia_km}km` : null, v.zona && v.zona !== "fora" ? v.zona : null].filter(Boolean).join(" · ");
  linhas.push(`🏢 ${esc(v.empresa || "—")}${loc.length ? ` · ${loc.join(" ")}${zdist ? ` (${zdist})` : ""}` : ""}`);

  const contrato = [v.tipo_contrato, v.jornada].filter(Boolean).map(esc).join(" · ");
  const linha3 = [contrato || null, v.salario ? `💰 ${esc(v.salario)}` : null, idade(v.publicado_em)].filter(Boolean).join(" · ");
  if (linha3) linhas.push(`📄 ${linha3}`);

  if (v.experiencia === "sin experiencia") linhas.push("✅ <b>sin experiencia</b>");
  else if (v.experiencia === "exige experiencia") linhas.push("⚠️ exige experiência prévia");

  linhas.push("", `🔗 ${esc(v.url)}`);
  return linhas.join("\n");
}

async function coletar() {
  const brutos = [];
  for (const fonte of FONTES) {
    try {
      const raws = await fonte.fetch({ where: "Vigo", distance: 50, pais: "es", termos: perfil.termos });
      log(`local ${fonte.name}: ${raws.length} brutos`);
      for (const r of raws) {
        try {
          const v = fonte.normalize(r);
          if (v?.titulo && v?.url && v?.hash) brutos.push(v);
        } catch (e) {
          warn(`local normalize ${fonte.name}: ${e.message}`);
        }
      }
    } catch (e) {
      warn(`local fonte ${fonte.name} falhou: ${e.message}`);
    }
  }
  return brutos;
}

async function alertar() {
  const corte = perfil.alerta.corte;
  const sondaMin = perfil.alerta.sonda_min;
  const alerta = await candidatasLocal(corte, null, 8);
  const sonda = await candidatasLocal(sondaMin, corte, 3);
  const itens = [
    ...alerta.map((v) => ({ v, sonda: false })),
    ...sonda.map((v) => ({ v, sonda: true })),
  ];
  log(`local alerta: ${alerta.length} (≥${corte}) + ${sonda.length} sonda (${sondaMin}-${corte - 1})`);
  if (!itens.length) return 0;
  if (!telegramConfigurado()) {
    warn("local: Telegram não configurado");
    return 0;
  }
  const ok = [];
  for (const { v, sonda } of itens) {
    try {
      await enviarMensagem(formatarLocal(v, sonda));
      ok.push(v.id);
    } catch (e) {
      warn(`local envio falhou: ${e.message}`);
    }
  }
  if (ok.length) await marcarStatusLocal(ok, "alertado");
  return ok.length;
}

export async function rodarLocal() {
  const t0 = Date.now();
  const brutos = await coletar();

  // Dedupe: por hash dentro da run + contra o banco recente.
  const porHash = new Map();
  for (const v of brutos) if (!porHash.has(v.hash)) porHash.set(v.hash, v);
  const conhecidos = await hashesLocalRecentes(30);
  const novas = [...porHash.values()].filter((v) => !conhecidos.has(v.hash));
  log(`local dedupe: ${brutos.length} → ${novas.length} novas`);

  // Frescor: vaga operacional local com 30+ dias está morta. Só as recentes.
  const maxDias = perfil.frescor_dias ?? 7;
  const frescas = novas.filter((v) => {
    if (!v.publicado_em) return false; // sem data → não confirma frescor
    return (Date.now() - new Date(v.publicado_em).getTime()) / 864e5 <= maxDias;
  });
  log(`local frescor: ${frescas.length} com ≤ ${maxDias} dias (de ${novas.length})`);

  // Score local + mantém só as com sinal (≥ sonda_min).
  const pontuadas = frescas
    .map((v) => ({ ...v, ...pontuarLocal(v, perfil) }))
    .filter((v) => v.score >= perfil.alerta.sonda_min);
  log(`local score: ${pontuadas.length} com score ≥ ${perfil.alerta.sonda_min}`);

  const inseridas = await inserirVagasLocal(pontuadas);
  log(`local persistência: ${inseridas.length} gravadas`);

  const enviadas = await alertar();
  log(`local concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s · alertadas: ${enviadas}`);
}
