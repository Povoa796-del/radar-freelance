// Similaridade de Jaccard sobre shingles de N palavras.
// Usado no dedupe para pegar repost com título levemente alterado.
// Reaproveitado do radar do Ajedrez.

export function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos combinantes
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Conjunto de shingles (n-gramas de palavras) de um texto.
export function shingles(texto, n = 3) {
  const palavras = normalizarTexto(texto).split(" ").filter(Boolean);
  const set = new Set();
  if (palavras.length < n) {
    if (palavras.length) set.add(palavras.join(" "));
    return set;
  }
  for (let i = 0; i <= palavras.length - n; i++) {
    set.add(palavras.slice(i, i + n).join(" "));
  }
  return set;
}

// Índice de Jaccard entre dois conjuntos: |A∩B| / |A∪B|.
export function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 1;
  if (!setA.size || !setB.size) return 0;
  let intersecao = 0;
  for (const x of setA) if (setB.has(x)) intersecao++;
  const uniao = setA.size + setB.size - intersecao;
  return intersecao / uniao;
}

// Similaridade entre dois textos via shingles.
export function similaridade(textoA, textoB, n = 3) {
  return jaccard(shingles(textoA, n), shingles(textoB, n));
}
