// Normaliza valores monetários para USD.
// Taxas aproximadas, revisáveis à mão. Não é câmbio ao vivo de propósito:
// o gate só precisa de ordem de grandeza para decidir corte de ticket.
const TAXAS_USD = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CHF: 1.12,
  CAD: 0.73,
  AUD: 0.66,
  BRL: 0.18,
};

const SIMBOLOS = {
  "$": "USD",
  "US$": "USD",
  "€": "EUR",
  "£": "GBP",
  "chf": "CHF",
  "r$": "BRL",
};

export function moedaSuportada(moeda) {
  return Boolean(moeda) && moeda.toUpperCase() in TAXAS_USD;
}

// Converte um valor para USD. Retorna null se moeda desconhecida ou valor inválido.
export function paraUSD(valor, moeda) {
  if (valor == null || Number.isNaN(Number(valor))) return null;
  const taxa = TAXAS_USD[String(moeda || "").toUpperCase()];
  if (!taxa) return null;
  return Math.round(Number(valor) * taxa);
}

// Tenta identificar a moeda a partir de um texto livre ("€", "USD", "GBP"...).
export function detectarMoeda(texto) {
  if (!texto) return null;
  const t = String(texto).toLowerCase();
  const codigo = t.match(/\b(usd|eur|gbp|chf|cad|aud|brl)\b/);
  if (codigo) return codigo[1].toUpperCase();
  for (const [simbolo, moeda] of Object.entries(SIMBOLOS)) {
    if (t.includes(simbolo)) return moeda;
  }
  return null;
}
