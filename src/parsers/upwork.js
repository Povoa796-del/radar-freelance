// Parser Upwork — INICIAL/tolerante (por padrão de URL). Refinar com HTML real
// em test/fixtures/email-upwork.html para extrair budget/empresa/descrição.
import { extrairPorLinks } from "./_generico.js";

const RE_URL = /upwork\.com\/(jobs|nx|freelance-jobs|ab)\b/i;

export default {
  nome: "upwork",
  teste: (remetente) => /upwork\.com/i.test(remetente || ""),
  parse: (html) => extrairPorLinks(html, { origem: "upwork", reUrl: RE_URL }),
};
