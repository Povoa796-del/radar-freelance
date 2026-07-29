// Arbeitnow — foco Europa/DACH. Não retorna salário (budget fica null).
import { getJSON } from "../lib/http.js";
import { montarVaga, stripHtml, inferirTipo } from "../lib/vaga.js";

const API = "https://www.arbeitnow.com/api/job-board-api";

async function fetch() {
  const data = await getJSON(API);
  return data.data || [];
}

function normalize(raw) {
  const tipos = raw.job_types || [];
  return montarVaga({
    fonte: "arbeitnow",
    fonte_id: raw.slug,
    url: raw.url,
    titulo: raw.title,
    empresa: raw.company_name,
    descricao: stripHtml(raw.description),
    skills: raw.tags || [],
    tipo: inferirTipo(tipos.join(" ")),
    budget_min: null,
    budget_max: null,
    moeda: null,
    publicado_em: raw.created_at,
    remoto: raw.remote === true,
    fuso_exigido: raw.location || null,
    cliente_meta: { location: raw.location || null },
  });
}

export default { name: "arbeitnow", enabled: true, rateLimitMs: 1000, fetch, normalize };
