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

  // Precedência: o match mais específico ganha. Chave = (tipo, zona), onde
  // tipo cidade(0) < província(1) e zona z0(0) < z1(1) < z2(2). Menor chave vence.
  const zonas = Object.keys(geo?.zonas || {});
  let melhor = null; // { tipoRank, zonaRank, zona, local }
  const considerar = (m) => {
    if (!melhor || m.tipoRank < melhor.tipoRank || (m.tipoRank === melhor.tipoRank && m.zonaRank < melhor.zonaRank)) {
      melhor = m;
    }
  };
  zonas.forEach((zona, zonaRank) => {
    const def = geo.zonas[zona];
    for (const cidade of def.cidades || []) {
      if (casaTermo(hay, cidade)) considerar({ tipoRank: 0, zonaRank, zona, local: cidade });
    }
    for (const prov of def.provincias || []) {
      if (casaTermo(hay, prov)) considerar({ tipoRank: 1, zonaRank, zona, local: prov });
    }
  });

  if (melhor) return { presencial: true, modalidade, zona: melhor.zona, local: melhor.local };
  return { presencial: true, modalidade, zona: null, local: null };
}
