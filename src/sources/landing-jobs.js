// landing.jobs — board de tech de Portugal (eixo Lisboa/Porto). API pública, sem key.
// Traz salário estruturado (EUR), tags e localização; empresa vem do slug da URL.
import { getJSON } from "../lib/http.js";
import { montarVaga, stripHtml, inferirTipo } from "../lib/vaga.js";

const API = "https://landing.jobs/api/v1/jobs";

async function fetch(ctx = {}) {
  const cfg = ctx.config || {};
  const limit = cfg.limit ?? 50;
  const data = await getJSON(`${API}?limit=${limit}`);
  return Array.isArray(data) ? data : [];
}

function empresaDaUrl(url) {
  const m = String(url || "").match(/\/at\/([^/]+)\//);
  return m ? m[1].replace(/-/g, " ") : null;
}

function localizacao(locations) {
  return (locations || [])
    .map((l) => [l.city, l.country_code].filter(Boolean).join(", "))
    .filter(Boolean)
    .join(" / ");
}

function normalize(raw) {
  const local = localizacao(raw.locations);
  const descricao = stripHtml([raw.role_description, raw.main_requirements, raw.nice_to_have].filter(Boolean).join("\n"));
  return montarVaga({
    fonte: "landing-jobs",
    fonte_id: raw.id,
    url: raw.url,
    titulo: raw.title,
    empresa: empresaDaUrl(raw.url),
    descricao,
    skills: raw.tags || [],
    tipo: inferirTipo(raw.type, null, raw.title),
    budget_min: raw.gross_salary_low || null,
    budget_max: raw.gross_salary_high || null,
    moeda: raw.currency_code || null,
    publicado_em: raw.published_at,
    remoto: raw.remote === true,
    fuso_exigido: local || null,
    cliente_meta: { location: local || null, locations: raw.locations || [] },
  });
}

export default { name: "landing-jobs", enabled: false, rateLimitMs: 1000, fetch, normalize };
