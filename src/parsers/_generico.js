// Extrator tolerante por PADRÃO DE URL de vaga (não por estrutura de tabela).
// Preenche só url + titulo (do próprio link do e-mail); nunca inventa outros campos.
// É a base dos parsers iniciais — refinar cada um com o HTML real depois (empresa,
// budget, descrição saem do layout específico do remetente).
import { stripHtml } from "../lib/vaga.js";

const RE_ANCHOR = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

export function extrairPorLinks(html, { origem, reUrl }) {
  const vistos = new Set();
  const vagas = [];
  let m;
  RE_ANCHOR.lastIndex = 0;
  while ((m = RE_ANCHOR.exec(html || "")) !== null) {
    const url = m[1].trim();
    if (!reUrl.test(url)) continue;
    const titulo = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    if (!titulo || titulo.length < 3) continue;
    const chave = url.split("?")[0];
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    vagas.push({ origem, url, titulo });
  }
  return vagas;
}
