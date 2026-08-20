// Gate por modalidade de idioma (não por idioma do anúncio).
// Você não fala inglês, mas produz inglês escrito com pipeline + revisor.
import { normalizarTexto } from "./jaccard.js";

const RE_LUSO_HISPANO = /\b(espana|spain|espanol|castellano|portugal|portugues|brasil|brazil|latam|latinoamerica|iberoamerica)\b/;
const RE_EXIGE_ES_PT = /\b(native|fluent|nativo)\b[\w\s]{0,20}\b(spanish|portuguese|espanol|portugues)\b/;

// Cliente de mercado espanhol/português/brasileiro? (localização ou exigência de idioma)
export function lusoHispano(vaga) {
  const codigos = (vaga.cliente_meta?.locations || []).map((l) => String(l.country_code || "").toUpperCase());
  if (codigos.some((c) => ["ES", "PT", "BR"].includes(c))) return true;
  const hay = normalizarTexto(
    [vaga.fuso_exigido, vaga.cliente_meta?.location, vaga.titulo, vaga.descricao].filter(Boolean).join(" ")
  );
  return RE_LUSO_HISPANO.test(hay) || RE_EXIGE_ES_PT.test(hay);
}

// Decide a trilha escrita (comum aos ramos 'escrito' e 'falado interno').
function decidirEscrito(trilha, tipoNec, score) {
  if (trilha === "freelance") {
    return { rejeitar: false, entrega_ingles: true, mercado: "anglofono", lead_ingles: false };
  }
  // Emprego anglófono: só passa como lead 🔤 se for produção em escala e score ≥ 60.
  if (tipoNec === "producao_em_escala" && score >= 60) {
    return { rejeitar: false, entrega_ingles: true, mercado: "anglofono", lead_ingles: true };
  }
  return { rejeitar: true, motivo: "ingles_falado", entrega_ingles: false, mercado: "anglofono", lead_ingles: false };
}

// Decide passagem/rejeição por modalidade. `score` já calculado (para o corte de lead ≥60).
// A distinção que importa não é "fala inglês", é COM QUEM: alinhamento interno em inglês
// (standup, weekly, sync técnico) passa e só marca 🗣️; falar inglês COM O CLIENTE (o produto
// entregue) rejeita. Disponibilidade de horário/fuso não é critério aqui.
// Retorna { rejeitar, motivo?, entrega_ingles, mercado, lead_ingles, fala_interna }.
export function decidirIdioma(vaga, llm, score) {
  const modalidade = llm?.idioma_modalidade || "escrito"; // ausente → conservador (escrito)
  const interlocutor = llm?.interlocutor_falado || null;
  const tipoNec = llm?.tipo_de_necessidade || "funcao_individual";
  const trilha = vaga.score_detalhe?.trilha ?? (vaga.tipo === "emprego" ? "emprego" : "freelance");

  if (lusoHispano(vaga)) {
    return { rejeitar: false, entrega_ingles: false, mercado: "luso-hispano", lead_ingles: false, fala_interna: false };
  }

  // Mercado anglófono, com fala envolvida: só rejeita se for COM O CLIENTE.
  if (modalidade === "falado" || modalidade === "ambos") {
    if (interlocutor === "cliente") {
      return { rejeitar: true, motivo: "ingles_falado", entrega_ingles: false, mercado: "anglofono", lead_ingles: false, fala_interna: false };
    }
    // Interno (ou não classificado pelo LLM) — não rejeita; segue a mesma trilha da
    // entrega escrita, só marca que há alinhamento falado interno no alerta.
    return { ...decidirEscrito(trilha, tipoNec, score), fala_interna: true };
  }

  return { ...decidirEscrito(trilha, tipoNec, score), fala_interna: false };
}
