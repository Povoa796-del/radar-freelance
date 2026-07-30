// Receptor dos botões inline do Telegram (feedback loop).
// Sem servidor: usa getUpdates (o Telegram retém os updates por 24h e memoriza o
// offset confirmado). Roda no início de cada ciclo e via `--callbacks` para teste.
// Alternativa instantânea (webhook em Cloudflare Worker) está descrita na seção 14 do brief.
import { marcarStatus } from "./lib/supabase.js";
import { log, warn } from "./lib/log.js";

const API = "https://api.telegram.org";
const MAPA = { int: "interesse", desc: "descartado" };

async function chamar(token, metodo, params) {
  const resp = await fetch(`${API}/bot${token}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return resp.json();
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
  let processados = 0;
  let maxId = 0;

  for (const u of updates) {
    maxId = Math.max(maxId, u.update_id);
    const cq = u.callback_query;
    if (!cq?.data) continue;
    const [pref, id] = cq.data.split(":");
    const status = MAPA[pref];
    if (!status || !id) continue;
    try {
      await marcarStatus([id], status);
      await chamar(token, "answerCallbackQuery", { callback_query_id: cq.id, text: `Registrado: ${status}` });
      processados++;
    } catch (err) {
      warn(`callbacks: falha ao aplicar ${cq.data}: ${err.message}`);
    }
  }

  // Confirma o offset: o Telegram não reentrega esses updates nas próximas chamadas.
  if (maxId) await chamar(token, "getUpdates", { offset: maxId + 1, timeout: 0 });
  if (updates.length) log(`callbacks: ${processados} clique(s) aplicado(s) de ${updates.length} update(s)`);
  return { processados };
}
