// Cálculo de fit_skill (0–1). Compartilhado pelo gate (piso mínimo) e pelo scorer.
import { normalizarTexto } from "./jaccard.js";

// Casa `termo` como sequência de palavras no haystack normalizado (fronteira de palavra).
function casaTermo(hay, termo) {
  const t = normalizarTexto(termo);
  if (!t) return false;
  return new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(hay);
}

// Fit = interseção ponderada de palavras do perfil com o texto da vaga, normalizada 0–1.
// Usa fit_keywords (vocabulário em inglês, como as vagas são escritas); se ausente,
// cai para os stacks. Título pesa mais que a descrição.
export function fitSkill(vaga, perfil) {
  const hayTitulo = normalizarTexto(`${(vaga.skills || []).join(" ")} ${vaga.titulo}`);
  const hayDesc = normalizarTexto((vaga.descricao || "").slice(0, 1200));

  const kws = perfil.fit_keywords;
  let pontos = 0;
  if (kws && Object.keys(kws).length) {
    for (const [kw, peso] of Object.entries(kws)) {
      if (casaTermo(hayTitulo, kw)) pontos += peso; // título: peso cheio
      else if (casaTermo(hayDesc, kw)) pontos += peso * 0.5; // descrição: metade
    }
  } else {
    const hay = `${hayTitulo} ${hayDesc}`;
    for (const s of perfil.stacks_core || []) if (casaTermo(hay, s)) pontos += 1.0;
    for (const s of perfil.stacks_aceitaveis || []) if (casaTermo(hay, s)) pontos += 0.5;
  }
  return Math.min(1, pontos / 3); // ~3 acertos fortes saturam
}
