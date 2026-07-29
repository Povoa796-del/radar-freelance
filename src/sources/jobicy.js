// Jobicy — tech + marketing. Salário estruturado (min/max/currency/period).
import { getJSON, dorme } from "../lib/http.js";
import { montarVaga, stripHtml, inferirTipo } from "../lib/vaga.js";

const API = "https://jobicy.com/api/v2/remote-jobs";

async function fetch(ctx = {}) {
  const cfg = ctx.config || {};
  const count = cfg.count ?? 50;
  const industries = cfg.industries || [null];
  const rate = cfg.rateLimitMs ?? 1000;
  const todos = [];
  for (const ind of industries) {
    const url = ind ? `${API}?count=${count}&industry=${encodeURIComponent(ind)}` : `${API}?count=${count}`;
    const data = await getJSON(url);
    todos.push(...(data.jobs || []));
    await dorme(rate);
  }
  return todos;
}

function normalize(raw) {
  const industria = Array.isArray(raw.jobIndustry) ? raw.jobIndustry : [raw.jobIndustry].filter(Boolean);
  return montarVaga({
    fonte: "jobicy",
    fonte_id: raw.id,
    url: raw.url,
    titulo: raw.jobTitle,
    empresa: raw.companyName,
    descricao: stripHtml(raw.jobDescription || raw.jobExcerpt),
    skills: industria,
    tipo: inferirTipo(Array.isArray(raw.jobType) ? raw.jobType.join(" ") : raw.jobType, raw.salaryPeriod, raw.jobTitle),
    budget_min: raw.salaryMin || null,
    budget_max: raw.salaryMax || null,
    moeda: raw.salaryCurrency || null,
    publicado_em: raw.pubDate,
    remoto: true,
    fuso_exigido: raw.jobGeo || null,
    cliente_meta: { level: raw.jobLevel || null, geo: raw.jobGeo || null },
  });
}

export default { name: "jobicy", enabled: true, rateLimitMs: 1000, fetch, normalize };
