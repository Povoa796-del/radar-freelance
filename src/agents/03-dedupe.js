// 03 — deduplicação em três camadas:
//  1. hash da URL canônica (dentro da run e contra o banco)
//  2. fingerprint (titulo+empresa) — mesma vaga em boards diferentes
//  3. Jaccard sobre shingles de titulo + início da descrição (repost com título alterado)
import { vagasRecentes } from "../lib/supabase.js";
import { similaridade } from "../lib/jaccard.js";
import { log } from "../lib/log.js";

const JACCARD_MIN = 0.75;

// Entre duas vagas com mesmo fingerprint, mantém a mais informativa.
function escolherMelhor(a, b) {
  const pontos = (v) => (v.budget_usd ? 2 : 0) + (v.descricao?.length || 0) / 1000;
  const melhor = pontos(b) > pontos(a) ? b : a;
  const outro = melhor === a ? b : a;
  const fontes = new Set([...(melhor.cliente_meta.fontes || [melhor.fonte]), outro.fonte]);
  melhor.cliente_meta = { ...melhor.cliente_meta, fontes: [...fontes] };
  return melhor;
}

function textoJaccard(v) {
  return `${v.titulo} ${(v.descricao || "").slice(0, 500)}`;
}

export async function deduplicar(vagas, { janelaDias = 30 } = {}) {
  // Uma única leitura do banco recente para todas as camadas contra o histórico.
  const recentes = await vagasRecentes(janelaDias);
  const hashesBanco = new Set(recentes.map((r) => r.hash));
  const fpsBanco = new Set(recentes.map((r) => r.fingerprint));

  // Camada 1a — hash dentro da run
  const porHash = new Map();
  for (const v of vagas) if (!porHash.has(v.hash)) porHash.set(v.hash, v);
  let unicas = [...porHash.values()];

  // Camada 1b — hash já no banco
  unicas = unicas.filter((v) => !hashesBanco.has(v.hash));

  // Camada 2 — fingerprint dentro da run (merge)
  const porFp = new Map();
  for (const v of unicas) {
    const existente = porFp.get(v.fingerprint);
    porFp.set(v.fingerprint, existente ? escolherMelhor(existente, v) : v);
  }
  unicas = [...porFp.values()];
  const resultado = [];
  for (const v of unicas) {
    if (fpsBanco.has(v.fingerprint)) continue;
    const tv = textoJaccard(v);
    const repost = recentes.some((r) => similaridade(tv, textoJaccard(r)) >= JACCARD_MIN);
    if (repost) continue;
    resultado.push(v);
  }

  log(`dedupe: ${vagas.length} -> ${resultado.length} novas (removidas ${vagas.length - resultado.length})`);
  return resultado;
}
