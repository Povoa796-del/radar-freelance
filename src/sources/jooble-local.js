// Jooble LOCAL — Vigo/arredores presencial. POST por cidade-alvo com termos em espanhol.
// Fluxo separado do jooble.js (remoto). Lê JOOBLE_KEY. Reforço de volume/frescor do
// Radar Local (o Adzuna sozinho dá pouca vaga fresca).
import { postJSON, dorme } from "../lib/http.js";
import { montarVaga, stripHtml } from "../lib/vaga.js";

async function fetch(cfg = {}) {
  const key = process.env.JOOBLE_KEY;
  if (!key) throw new Error("JOOBLE_KEY ausente no env");

  const cidades = cfg.cidades || ["Vigo"];
  const keywords = (cfg.termos || []).join(" OR ") || "almacen OR administrativo";
  const rate = cfg.rateLimitMs ?? 1000;

  const todos = [];
  const vistos = new Set();
  for (const cidade of cidades) {
    let data;
    try {
      data = await postJSON(`https://jooble.org/api/${key}`, { keywords, location: cidade });
    } catch {
      data = { jobs: [] };
    }
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
  const base = montarVaga({
    fonte: "jooble-local",
    fonte_id: raw.id || raw.link,
    url: raw.link,
    titulo: raw.title,
    empresa: raw.company || null,
    descricao: stripHtml(raw.snippet),
    publicado_em: raw.updated,
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
    local: raw.location || null,
    tipo_contrato: raw.type || null,
    jornada: null,
    salario: raw.salary || null,
  };
}

export default { name: "jooble-local", fetch, normalize };
