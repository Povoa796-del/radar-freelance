// Jooble — única via para o Alto Minho português (Adzuna não cobre PT).
// enabled:false até a chave chegar. Lê JOOBLE_KEY do env. POST por cidade-alvo.
// NOTA: normalize baseado no schema documentado do Jooble; capturar fixture real e validar
// com a chave ANTES de habilitar (regra: fixture real antes do normalize).
import { postJSON, dorme } from "../lib/http.js";
import { montarVaga, stripHtml, inferirTipo, parseSalario } from "../lib/vaga.js";

async function fetch(ctx = {}) {
  const cfg = ctx.config || {};
  const key = process.env.JOOBLE_KEY;
  if (!key) throw new Error("JOOBLE_KEY ausente no env");

  const cidades = cfg.cidades || ["Vigo", "Pontevedra", "Braga", "Porto", "Viana do Castelo"];
  const keywords = cfg.keywords || "automation OR content OR developer OR IA";
  const rate = cfg.rateLimitMs ?? 1000;

  const todos = [];
  const vistos = new Set();
  for (const cidade of cidades) {
    const data = await postJSON(`https://jooble.org/api/${key}`, { keywords, location: cidade });
    for (const j of data.jobs || []) {
      const id = j.id || j.link;
      if (id && !vistos.has(id)) {
        vistos.add(id);
        todos.push(j);
      }
    }
    await dorme(rate);
  }
  return todos;
}

function normalize(raw) {
  const texto = `${raw.title || ""} ${raw.snippet || ""}`.toLowerCase();
  const remoto = /\b(remote|teletrabalho|teletrabajo|remoto)\b/.test(texto);
  const sal = parseSalario(raw.salary);
  return montarVaga({
    fonte: "jooble",
    fonte_id: raw.id || raw.link,
    url: raw.link,
    titulo: raw.title,
    empresa: raw.company || null,
    descricao: stripHtml(raw.snippet),
    skills: [],
    tipo: inferirTipo(raw.type, null, raw.title),
    budget_min: sal.min,
    budget_max: sal.max,
    moeda: sal.moeda,
    publicado_em: raw.updated,
    remoto,
    fuso_exigido: raw.location || null,
    cliente_meta: { location: raw.location || null, source: raw.source || null },
  });
}

export default { name: "jooble", enabled: false, rateLimitMs: 1000, fetch, normalize };
