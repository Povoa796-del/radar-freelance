// Adzuna — cobre o lado espanhol (presencial perto de Vigo). API grátis (app_id + app_key).
// Lê ADZUNA_APP_ID / ADZUNA_APP_KEY do env. Fixture real capturado (test/fixtures/adzuna.json).
import { getJSON, dorme } from "../lib/http.js";
import { montarVaga, stripHtml, inferirTipo } from "../lib/vaga.js";

const MOEDA_PAIS = { es: "EUR", gb: "GBP", us: "USD", fr: "EUR", de: "EUR", pt: "EUR" };

async function fetch(ctx = {}) {
  const cfg = ctx.config || {};
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error("ADZUNA_APP_ID / ADZUNA_APP_KEY ausentes no env");

  const pais = cfg.pais || "es";
  const where = cfg.where || "Vigo";
  const distance = cfg.distance ?? 60;
  const resultsPerPage = cfg.results ?? 50;
  const paginas = cfg.paginas ?? 1;
  const rate = cfg.rateLimitMs ?? 1200;

  const todos = [];
  for (let p = 1; p <= paginas; p++) {
    const url =
      `https://api.adzuna.com/v1/api/jobs/${pais}/search/${p}` +
      `?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}` +
      `&where=${encodeURIComponent(where)}&distance=${distance}` +
      `&results_per_page=${resultsPerPage}&content-type=application/json`;
    const data = await getJSON(url);
    const results = data.results || [];
    todos.push(...results.map((r) => ({ ...r, _pais: pais })));
    if (results.length < resultsPerPage) break;
    if (p < paginas) await dorme(rate);
  }
  return todos;
}

function normalize(raw) {
  const texto = `${raw.title || ""} ${raw.description || ""}`.toLowerCase();
  const remoto = /\b(remote|teletrabajo|remoto|home\s?office)\b/.test(texto);
  return montarVaga({
    fonte: "adzuna",
    fonte_id: raw.id,
    url: raw.redirect_url,
    titulo: raw.title,
    empresa: raw.company?.display_name || null,
    descricao: stripHtml(raw.description),
    skills: raw.category?.label ? [raw.category.label] : [],
    tipo: inferirTipo(raw.contract_type || raw.contract_time, null, raw.title),
    budget_min: raw.salary_min ?? null,
    budget_max: raw.salary_max ?? null,
    moeda: MOEDA_PAIS[raw._pais] || "EUR",
    publicado_em: raw.created,
    remoto,
    fuso_exigido: raw.location?.display_name || null,
    cliente_meta: { location: raw.location?.display_name || null, categoria: raw.category?.label || null },
  });
}

export default { name: "adzuna", enabled: false, rateLimitMs: 1200, fetch, normalize };
