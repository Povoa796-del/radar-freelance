// Envio de mensagens no Telegram. Suporta botões inline (interesse / descartar).
const API = "https://api.telegram.org";

function creds() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return { token, chatId, ok: Boolean(token && chatId) };
}

export function telegramConfigurado() {
  return creds().ok;
}

// Envia uma mensagem HTML. `botoes` = [[{ text, callback_data }], ...] (opcional).
export async function enviarMensagem(texto, { botoes = null } = {}) {
  const { token, chatId, ok } = creds();
  if (!ok) throw new Error("TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID não configurados.");

  const body = {
    chat_id: chatId,
    text: texto,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (botoes) body.reply_markup = { inline_keyboard: botoes };

  const resp = await fetch(`${API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(`Telegram falhou: ${json.description || resp.status}`);
  return json.result;
}

// Escapa texto para o parse_mode HTML do Telegram.
export function esc(texto) {
  return String(texto || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
