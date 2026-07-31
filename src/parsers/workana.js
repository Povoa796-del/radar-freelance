// Parser Workana — INICIAL/tolerante (por padrão de URL). Refinar com HTML real
// em test/fixtures/email-workana.html.
import { extrairPorLinks } from "./_generico.js";

const RE_URL = /workana\.com\/job\//i;

export default {
  nome: "workana",
  teste: (remetente) => /workana\.com/i.test(remetente || ""),
  parse: (html) => extrairPorLinks(html, { origem: "workana", reUrl: RE_URL }),
};
