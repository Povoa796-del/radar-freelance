// Parser LinkedIn — INICIAL/tolerante (por padrão de URL). Refinar com HTML real
// em test/fixtures/email-linkedin.html (os alertas são tabelas aninhadas que mudam).
import { extrairPorLinks } from "./_generico.js";

const RE_URL = /linkedin\.com\/(jobs\/view|comm\/jobs|jobs)\b/i;

export default {
  nome: "linkedin",
  teste: (remetente) => /linkedin\.com/i.test(remetente || ""),
  parse: (html) => extrairPorLinks(html, { origem: "linkedin", reUrl: RE_URL }),
};
