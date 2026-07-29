// RemoteOK — array JSON. O primeiro item é metadata legal, descartar. Atribuição obrigatória.
import { getJSON } from "../lib/http.js";
import { montarVaga, stripHtml, inferirTipo } from "../lib/vaga.js";

const API = "https://remoteok.com/api";

async function fetch() {
  const data = await getJSON(API);
  if (!Array.isArray(data)) return [];
  // Descarta o item 0 (last_updated / legal).
  return data.filter((it) => it && it.id && it.position);
}

function normalize(raw) {
  const tags = raw.tags || [];
  const ehGig = tags.some((t) => /contract|freelance/i.test(t));
  return montarVaga({
    fonte: "remoteok",
    fonte_id: raw.id,
    url: raw.url || `https://remoteok.com/remote-jobs/${raw.slug}`,
    titulo: raw.position,
    empresa: raw.company,
    descricao: stripHtml(raw.description),
    skills: tags,
    tipo: ehGig ? inferirTipo("contract") : "emprego",
    budget_min: raw.salary_min || null,
    budget_max: raw.salary_max || null,
    moeda: "USD",
    publicado_em: raw.date || raw.epoch,
    remoto: true,
    fuso_exigido: null,
    cliente_meta: { location: raw.location || null },
  });
}

export default { name: "remoteok", enabled: true, rateLimitMs: 2000, fetch, normalize };
