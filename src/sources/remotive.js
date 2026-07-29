// Remotive — curado, bom sinal/ruído. Salário vem como string livre.
import { getJSON, dorme } from "../lib/http.js";
import { montarVaga, stripHtml, inferirTipo, parseSalario } from "../lib/vaga.js";

const API = "https://remotive.com/api/remote-jobs";

async function fetch(ctx = {}) {
  const cfg = ctx.config || {};
  const cats = cfg.categorias || ["software-dev"];
  const limit = cfg.limit ?? 50;
  const rate = cfg.rateLimitMs ?? 1000;
  const todos = [];
  for (const cat of cats) {
    const data = await getJSON(`${API}?category=${encodeURIComponent(cat)}&limit=${limit}`);
    todos.push(...(data.jobs || []));
    await dorme(rate);
  }
  return todos;
}

function normalize(raw) {
  const sal = parseSalario(raw.salary);
  return montarVaga({
    fonte: "remotive",
    fonte_id: raw.id,
    url: raw.url,
    titulo: raw.title,
    empresa: raw.company_name,
    descricao: stripHtml(raw.description),
    skills: raw.tags || [],
    tipo: inferirTipo(raw.job_type, null, raw.title),
    budget_min: sal.min,
    budget_max: sal.max,
    moeda: sal.moeda,
    publicado_em: raw.publication_date,
    remoto: true,
    fuso_exigido: raw.candidate_required_location || null,
    cliente_meta: { categoria: raw.category || null, location: raw.candidate_required_location || null },
  });
}

export default { name: "remotive", enabled: true, rateLimitMs: 1000, fetch, normalize };
