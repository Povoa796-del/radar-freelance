// Detecta item que NÃO é vaga: página institucional/marketing raspada como se fosse
// posting (o LLM "aluciva" campos de vaga a partir de conteúdo de marketing).
// Roda no gate, antes do LLM.
//
// Regra: descarta se o texto tem sinais de marketing/institucional E NENHUMA estrutura
// de posting (responsabilidades, requisitos, como aplicar, "procuramos"). Conservador:
// exige zero estrutura de vaga — um posting real tem pelo menos um desses.

const RE_MARKETING = [
  /\bterms (of service|& conditions|and conditions)\b/i,
  /\bprivacy policy\b/i,
  /\bfrequently asked questions\b|(^|[^a-z])FAQ([^a-z]|$)/i,
  /\bfree trial\b|\bsign up (free|now|today)\b|\bbook a demo\b|\bget started (free|now|today)\b/i,
  /\bwhat our (customers|clients) say\b|\bcustomer (stories|testimonials?)\b|\btestimonials?\b/i,
  /\b(our|the) (platform|product|software|solution|app|tool)\b/i,
  /\bunlike (generic|other|traditional)\b|\ball-in-one\b|\bai-powered\b|\bpowered by ai\b/i,
  /\bpricing\b|\bplans? (start|starting) (at|from)\b|\b(monthly|annual) plan\b/i,
];

const RE_POSTING = [
  /\bresponsibilities\b|\bresponsabilidades\b/i,
  /\brequirements\b|\bqualifications\b|\brequisitos\b|\bqualificaç/i,
  /\bwhat you(?:'|’|`)?ll do\b|\bwhat you will do\b/i,
  /\bhow to apply\b|\bto apply\b|\bapply (now|here|today|via|by|through)\b|\bwhen applying\b|\bcomo (se )?candidatar\b/i,
  /\bwe(?:'|’|`)?re looking for\b|\bwe are looking for\b|\bwe seek\b|\bseeking (a|an)\b|\bprocuramos\b|\bestamos (procurando|buscando)\b/i,
  /\byears? of experience\b|\banos de experiência\b/i,
  /\bkey responsibilities\b|\bwhat we offer\b|\bnice to have\b|\bmust have\b/i,
  /\byou will\b|\byou(?:'|’|`)?ll be\b/i,
];

export function pareceNaoVaga(vaga) {
  const texto = `${vaga.titulo || ""} ${vaga.descricao || ""}`;
  const marketing = RE_MARKETING.filter((re) => re.test(texto)).length;
  const posting = RE_POSTING.filter((re) => re.test(texto)).length;
  return posting === 0 && marketing >= 2;
}
