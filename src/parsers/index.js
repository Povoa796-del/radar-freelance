// Registro de parsers de e-mail, por remetente.
// Cada parser: { nome, teste(remetente)->bool, parse(html, meta)->RawJob[] }.
//
// RawJob (convenção que o gmail-alerts.normalize consome):
//   { origem, titulo, url, empresa?, descricao?, budget_min?, budget_max?,
//     moeda?, local?, publicado_em?, tipo?, remoto?, skills? }
//
// Parsers entram AQUI conforme o HTML real de cada remetente chega em
// test/fixtures/ (ver regra CRÍTICA do Bloco 2). Vazio = todo e-mail cai em
// "remetente sem parser" e é descartado silenciosamente (com contagem).
export const PARSERS = [
  // import upwork from "./upwork.js";  { nome: "upwork", teste: (r) => /upwork\.com/i.test(r), parse: upwork },
  // import linkedin from "./linkedin.js";
  // import workana from "./workana.js";
];

export function parserPara(remetente) {
  return PARSERS.find((p) => p.teste(remetente)) || null;
}
