// Adzuna LOCAL — Vigo presencial. Uma query por termo em espanhol, where=Vigo, raio ~50km,
// SEM filtro de remoto. Fluxo separado do adzuna.js (remoto/tech). Lê ADZUNA_APP_ID/KEY.
import { getJSON, dorme } from "../lib/http.js";
import { montarVaga, stripHtml } from "../lib/vaga.js";

const enc = encodeURIComponent;

async function fetch(cfg = {}) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error("ADZUNA_APP_ID / ADZUNA_APP_KEY ausentes no env");

  const pais = cfg.pais || "es";
  const where = cfg.where || "Vigo";
  const distance = cfg.distance ?? 50;
  const termos = cfg.termos || [];
  const rate = cfg.rateLimitMs ?? 1200;

  const todos = [];
  const vistos = new Set();
  for (const termo of termos) {
    const url =
      `https://api.adzuna.com/v1/api/jobs/${pais}/search/1` +
      `?app_id=${enc(appId)}&app_key=${enc(appKey)}` +
      `&where=${enc(where)}&distance=${distance}&what=${enc(termo)}` +
      `&results_per_page=50&content-type=application/json`;
    let data;
    try {
      data = await getJSON(url);
    } catch {
      data = { results: [] };
    }
    for (const r of data.results || []) {
      if (r.id && !vistos.has(r.id)) {
        vistos.add(r.id);
        todos.push(r);
      }
    }
    await dorme(rate);
  }
  return todos;
}

function fmtSalario(min, max) {
  if (!min && !max) return null;
  const f = (n) => Number(n).toLocaleString("es-ES", { maximumFractionDigits: 0 });
  if (min && max && min !== max) return `${f(min)}–${f(max)} €`;
  return `${f(max || min)} €`;
}

function normalize(raw) {
  const base = montarVaga({
    fonte: "adzuna-local",
    fonte_id: raw.id,
    url: raw.redirect_url,
    titulo: raw.title,
    empresa: raw.company?.display_name || null,
    descricao: stripHtml(raw.description),
    publicado_em: raw.created,
    moeda: "EUR",
    budget_min: raw.salary_min ?? null,
    budget_max: raw.salary_max ?? null,
  });
  return {
    fonte: base.fonte,
    fonte_id: base.fonte_id,
    url: base.url,
    titulo: base.titulo,
    empresa: base.empresa,
    descricao: base.descricao,
    hash: base.hash,
    fingerprint: base.fingerprint,
    publicado_em: base.publicado_em,
    local: raw.location?.display_name || null,
    tipo_contrato: raw.contract_type || null,
    jornada: raw.contract_time || null,
    salario: fmtSalario(raw.salary_min, raw.salary_max),
  };
}

export default { name: "adzuna-local", fetch, normalize };
