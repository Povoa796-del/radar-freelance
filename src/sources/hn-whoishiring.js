// HN "Ask HN: Who is hiring?" — melhor fonte para gigs de IA/automação bem pagos.
// fetch acha a thread mensal mais recente e puxa os comentários top-level.
import { getJSON } from "../lib/http.js";
import { montarVaga, stripHtml, parseSalario, inferirTipo } from "../lib/vaga.js";

const BUSCA = "https://hn.algolia.com/api/v1/search_by_date";
const ITEM = "https://hn.algolia.com/api/v1/items";

// Vocabulário para extrair skills do texto livre do comentário.
const VOCAB = [
  "node", "node.js", "next.js", "nextjs", "react", "typescript", "javascript",
  "python", "go", "golang", "rust", "cloudflare", "supabase", "postgres",
  "aws", "gcp", "azure", "docker", "kubernetes", "llm", "ai", "gpt",
  "openai", "anthropic", "claude", "langchain", "rag", "automation",
  "puppeteer", "playwright", "scraping", "seo", "ffmpeg", "remotion",
  "n8n", "airtable", "stripe", "astro", "vercel", "graphql", "ml",
];

function extrairSkills(texto) {
  const t = ` ${String(texto || "").toLowerCase()} `;
  return VOCAB.filter((k) => t.includes(` ${k} `) || t.includes(`${k},`) || t.includes(`${k}.`) || t.includes(`(${k}`));
}

async function fetch() {
  const busca = await getJSON(`${BUSCA}?tags=story,author_whoishiring&query=hiring&hitsPerPage=5`);
  const thread = (busca.hits || []).find((h) => /who is hiring/i.test(h.title || ""));
  if (!thread) return [];
  const item = await getJSON(`${ITEM}/${thread.objectID}`);
  return (item.children || [])
    .filter((c) => c && c.text && c.author && !c.deleted && c.text.length > 120)
    .map((c) => ({ ...c, _threadId: thread.objectID }));
}

function normalize(raw) {
  const texto = stripHtml(raw.text);
  const primeiraLinha = texto.split("\n")[0];
  const partes = primeiraLinha.split("|").map((s) => s.trim()).filter(Boolean);

  // Formato convencional do HN: "Empresa | Cargo | Local | REMOTE | ...".
  // Sem os pipes é prosa livre: não dá para inferir empresa com segurança.
  const temPipes = partes.length > 1;
  const empresa = temPipes ? partes[0] : null;
  const titulo = temPipes ? partes.slice(1, 3).join(" — ") : primeiraLinha.slice(0, 100);

  // URL: primeiro link do comentário; senão, o permalink do próprio comentário.
  const linkMatch = String(raw.text).match(/href="(https?:\/\/[^"]+)"/i);
  const url = linkMatch ? linkMatch[1] : `https://news.ycombinator.com/item?id=${raw.id}`;

  // Budget: só confiável no cabeçalho pipe-delimitado ("Empresa | Cargo | ... | $120k").
  // Prosa livre gera falso positivo (custos, quantidades) — nesse caso, budget fica null.
  const s = temPipes ? parseSalario(partes.join(" | ")) : { moeda: null, max: null };
  const sal = s.moeda && s.max >= 1000 ? s : { min: null, max: null, moeda: null };
  const remoto = /\bremote\b/i.test(texto);
  const ehGig = /contract|freelance|part-?time|contractor/i.test(texto);

  return montarVaga({
    fonte: "hn-whoishiring",
    fonte_id: raw.id,
    url,
    titulo: titulo || empresa,
    empresa,
    descricao: texto,
    skills: extrairSkills(texto),
    tipo: ehGig ? inferirTipo(texto) : "emprego",
    budget_min: sal.min,
    budget_max: sal.max,
    moeda: sal.moeda,
    publicado_em: raw.created_at || raw.created_at_i,
    remoto,
    fuso_exigido: null,
    cliente_meta: { hn_thread: raw._threadId || null, autor: raw.author || null },
  });
}

export default { name: "hn-whoishiring", enabled: true, rateLimitMs: 500, fetch, normalize };
