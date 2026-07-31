// Registro de parsers de e-mail, por remetente.
// Cada parser: { nome, teste(remetente)->bool, parse(html, meta)->RawJob[] }.
//
// RawJob (convenção que o gmail-alerts.normalize consome):
//   { origem, titulo, url, empresa?, descricao?, budget_min?, budget_max?,
//     moeda?, local?, publicado_em?, tipo?, remoto?, skills? }
//
// Estes são INICIAIS/tolerantes (por padrão de URL, ver _generico.js). Quando o HTML
// real de cada remetente chegar em test/fixtures/, refinar para extrair budget/empresa/etc.
import upwork from "./upwork.js";
import linkedin from "./linkedin.js";
import workana from "./workana.js";

export const PARSERS = [upwork, linkedin, workana];

export function parserPara(remetente) {
  return PARSERS.find((p) => p.teste(remetente)) || null;
}
