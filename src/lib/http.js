// GET com User-Agent identificável e parsing de JSON. Usa fetch nativo do Node.
const UA = "radar-freelance/0.1 (+https://github.com/; contato via Telegram)";

export async function getJSON(url, { timeoutMs = 30000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}`);
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

export async function postJSON(url, body, { timeoutMs = 30000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}`);
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

export function dorme(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
