// Receptor dos botões inline do Telegram (feedback loop).
// Sem servidor: usa getUpdates (o Telegram retém os updates por 24h e memoriza o
// offset confirmado). Roda no início de cada ciclo e via `--callbacks` para teste.
//
// Depois de gravar o status, dá retorno visual (answerCallbackQuery + edição da
// mensagem). Cliques repetidos/conflitantes na mesma janela: mantém o PRIMEIRO e
// loga — clique repetido é sintoma de falta de retorno, não de mudança de opinião.
import { marcarStatus, buscarVaga } from "./lib/supabase.js";
import { formatarVaga } from "./agents/07-alerta.js";
import { log, warn } from "./lib/log.js";

const API = "https://api.telegram.org";
const MAPA = { int: "interesse", desc: "descartado" };
const MARCADOR = { interesse: "✅ interesse", descartado: "✖️ descartado" };

async function chamar(token, metodo, params) {
  const resp = await fetch(`${API}/bot${token}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return resp.json();
}

// Resolve a janela de cliques: primeiro clique por vaga vence. Puro e testável.
export function decidirCliques(updates) {
  const decididos = new Map();
  const acoes = [];
  const conflitos = [];
  let maxId = 0;
  for (const u of updates) {
    if (u.update_id > maxId) maxId = u.update_id;
    const cq = u.callback_query;
    if (!cq?.data) continue;
    const [pref, id] = cq.data.split(":");
    const status = MAPA[pref];
    if (!status || !id) {
      acoes.push({ tipo: "noop", cbId: cq.id });
      continue;
    }
    if (decididos.has(id)) {
      const mantido = decididos.get(id);
      conflitos.push({ id, mantido, ignorado: status });
      acoes.push({ tipo: "repetido", id, status: mantido, cbId: cq.id });
    } else {
      decididos.set(id, status);
      acoes.push({ tipo: "primeiro", id, status, cbId: cq.id, message: cq.message });
    }
  }
  return { acoes, conflitos, maxId };
}

// Edita a mensagem original: re-renderiza (preserva formatação), acrescenta o marcador
// e remove os botões — sem botão não há clique repetido.
async function editarMensagem(token, message, id, status) {
  if (!message) return;
  try {
    const vaga = await buscarVaga(id);
    if (!vaga) return;
    await chamar(token, "editMessageText", {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: `${formatarVaga(vaga)}\n\n<b>${MARCADOR[status]}</b>`,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (err) {
    warn(`callbacks: não consegui editar a mensagem de ${id}: ${err.message}`);
  }
}

export async function processarCallbacks() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { processados: 0 };

  const r = await chamar(token, "getUpdates", { timeout: 0, allowed_updates: ["callback_query"] });
  if (!r.ok) {
    warn(`callbacks: getUpdates falhou: ${r.description}`);
    return { processados: 0 };
  }
  const updates = r.result || [];
  const { acoes, conflitos, maxId } = decidirCliques(updates);

  let processados = 0;
  for (const a of acoes) {
    if (a.tipo === "primeiro") {
      try {
        await marcarStatus([a.id], a.status);
        await editarMensagem(token, a.message, a.id, a.status);
        await chamar(token, "answerCallbackQuery", { callback_query_id: a.cbId, text: `registrado: ${a.status}` });
        processados++;
      } catch (err) {
        warn(`callbacks: falha ao aplicar ${a.id}=${a.status}: ${err.message}`);
      }
    } else if (a.tipo === "repetido") {
      // Mantém o primeiro; só reforça o retorno visual (sem re-editar a mensagem).
      await chamar(token, "answerCallbackQuery", { callback_query_id: a.cbId, text: `já registrado: ${a.status}` });
    } else {
      // Clique num marcador já resolvido (botão removido) ou dado inesperado: tira o spinner.
      await chamar(token, "answerCallbackQuery", { callback_query_id: a.cbId });
    }
  }

  for (const c of conflitos) {
    warn(`callbacks: clique repetido/conflitante em ${c.id} — mantido '${c.mantido}', ignorado '${c.ignorado}'`);
  }

  // Confirma o offset: o Telegram não reentrega esses updates nas próximas chamadas.
  if (maxId) await chamar(token, "getUpdates", { offset: maxId + 1, timeout: 0 });
  if (updates.length) {
    log(`callbacks: ${processados} aplicado(s), ${conflitos.length} conflito(s) mantendo o 1º, de ${updates.length} update(s)`);
  }
  return { processados, conflitos: conflitos.length };
}
