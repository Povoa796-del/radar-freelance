// Leitura de e-mail via IMAP (Gmail). Usa imapflow (cliente IMAP) + mailparser
// (extrai html/texto do MIME). Credenciais no env: GMAIL_USER / GMAIL_APP_PASSWORD.
//
// DEPENDÊNCIAS NOVAS: imapflow, mailparser — instalar só após seu OK.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

// Lê mensagens NÃO LIDAS da label do Gmail (ex: "radar"). Não marca como lida —
// o dedupe é por messageId (tabela emails_processados). Retorna:
//   { remetente, assunto, html, texto, data, messageId }[]
export async function lerNaoLidas(label = "radar", { limite = 50 } = {}) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD ausentes no env");

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const mensagens = [];
  await client.connect();
  try {
    // No Gmail, cada label é uma "mailbox" e o nome é case-sensitive ("Radar" ≠ "radar").
    // Resolve o path real casando a label sem diferenciar caixa.
    const boxes = await client.list();
    const box = boxes.find(
      (b) => b.path.toLowerCase() === label.toLowerCase() || b.name.toLowerCase() === label.toLowerCase()
    );
    if (!box) {
      throw new Error(`Label '${label}' não encontrada. Disponíveis: ${boxes.map((b) => b.path).join(", ")}`);
    }
    const lock = await client.getMailboxLock(box.path);
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of (uids || []).slice(0, limite)) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg?.source) continue;
        const mail = await simpleParser(msg.source);
        mensagens.push({
          remetente: mail.from?.text || "",
          assunto: mail.subject || "",
          html: mail.html || "",
          texto: mail.text || "",
          data: mail.date || null,
          messageId: mail.messageId || `uid:${uid}`,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return mensagens;
}
