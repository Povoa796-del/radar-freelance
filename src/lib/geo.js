// Avaliação geográfica de uma vaga: modalidade (remoto/híbrido/presencial) e zona.
// A zona NÃO entra no score (v2) — é só metadado para o gate decidir e para exibir.
import { normalizarTexto } from "./jaccard.js";

// Regexes operam sobre texto JÁ normalizado (sem acento/pontuação; hífen já virou espaço).
const RE_HIBRIDO = /\b(hybrid|hibrid\w*)\b/;
const RE_ONSITE = /\b(on ?site|in ?office|presencial|relocat\w*|no remote|must be (?:located|based))\b/;

// Casa `termo` como sequência de palavras no haystack normalizado (fronteira de palavra).
function casaTermo(hay, termo) {
  const t = normalizarTexto(termo);
  if (!t) return false;
  return new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(hay);
}

// Retorna { presencial, modalidade, zona, local }.
// - remoto: presencial=false, zona=null
// - presencial/híbrido: procura a localização em geo.zonas (z0→z1→z2, primeiro que casar)
export function avaliarGeo(vaga, geo) {
  const texto = normalizarTexto(`${vaga.titulo} ${vaga.descricao || ""}`);
  const hibrido = RE_HIBRIDO.test(texto);
  const onsite = RE_ONSITE.test(texto);
  const presencial = vaga.remoto === false || hibrido || onsite;

  if (!presencial) return { presencial: false, modalidade: "remoto", zona: null, local: null };
  const modalidade = hibrido ? "híbrido" : "presencial";

  const hay = normalizarTexto(
    [vaga.fuso_exigido, vaga.cliente_meta?.location, vaga.titulo, vaga.descricao].filter(Boolean).join(" ")
  );
  for (const [zona, def] of Object.entries(geo?.zonas || {})) {
    for (const termo of [...(def.cidades || []), ...(def.provincias || [])]) {
      if (casaTermo(hay, termo)) return { presencial: true, modalidade, zona, local: termo };
    }
  }
  return { presencial: true, modalidade, zona: null, local: null };
}
