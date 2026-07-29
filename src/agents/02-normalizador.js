// 02 — normalizador. RawJob -> Vaga, chamando o normalize() puro de cada fonte.
// Erro em um item não descarta os outros da mesma fonte.
import { warn } from "../lib/log.js";

export function normalizar(coletas) {
  const vagas = [];
  for (const { fonte, adapter, raws } of coletas) {
    let ok = 0;
    for (const raw of raws) {
      try {
        const v = adapter.normalize(raw);
        if (v && v.titulo && v.url && v.hash) {
          vagas.push(v);
          ok++;
        }
      } catch (err) {
        warn(`normalize ${fonte} falhou em um item: ${err.message}`);
      }
    }
  }
  return vagas;
}
