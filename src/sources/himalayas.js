// Himalayas — board remoto. Máx. 20 vagas por request; paginar por offset.
import { getJSON, dorme } from "../lib/http.js";
import { montarVaga, stripHtml, inferirTipo } from "../lib/vaga.js";

const API = "https://himalayas.app/jobs/api";

async function fetch(ctx = {}) {
  const cfg = ctx.config || {};
  const maxPaginas = cfg.max_paginas ?? 3;
  const rate = cfg.rateLimitMs ?? 1500;
  const todos = [];
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const offset = pagina * 20;
    const data = await getJSON(`${API}?limit=20&offset=${offset}`);
    const jobs = data.jobs || [];
    todos.push(...jobs);
    if (jobs.length < 20) break;
    if (pagina < maxPaginas - 1) await dorme(rate);
  }
  return todos;
}

function normalize(raw) {
  const cats = (raw.categories || raw.parentCategories || []).map((c) =>
    typeof c === "string" ? c : c?.name || c?.title || ""
  );
  return montarVaga({
    fonte: "himalayas",
    fonte_id: raw.guid,
    url: raw.applicationLink || `https://himalayas.app/companies/${raw.companySlug}/jobs`,
    titulo: raw.title,
    empresa: raw.companyName,
    descricao: stripHtml(raw.description || raw.excerpt),
    skills: cats,
    tipo: inferirTipo(raw.employmentType, raw.salaryPeriod),
    budget_min: raw.minSalary ?? null,
    budget_max: raw.maxSalary ?? null,
    moeda: raw.currency || "USD",
    publicado_em: raw.pubDate,
    remoto: true,
    fuso_exigido: (raw.timezoneRestrictions || []).join(", ") || null,
    cliente_meta: { seniority: raw.seniority || null, restricoes: raw.locationRestrictions || [] },
  });
}

export default { name: "himalayas", enabled: true, rateLimitMs: 1500, fetch, normalize };
