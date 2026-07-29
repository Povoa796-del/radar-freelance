// Wrapper de LLM com retry. DeepSeek para volume (classificação/extração),
// Anthropic opcional para o resumo do alerta.
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function dorme(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Chamada DeepSeek. `json: true` força saída em objeto JSON.
export async function deepseek(prompt, { json = false, temperatura = 0, tentativas = 3 } = {}) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY não configurada.");

  const body = {
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    temperature: temperatura,
  };
  if (json) body.response_format = { type: "json_object" };

  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        // 429 / 5xx: vale a pena repetir; 4xx de payload: não
        if (resp.status === 429 || resp.status >= 500) throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        throw Object.assign(new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`), { fatal: true });
      }
      const data = await resp.json();
      const conteudo = data.choices?.[0]?.message?.content ?? "";
      return json ? parseJSON(conteudo) : conteudo;
    } catch (err) {
      ultimoErro = err;
      if (err.fatal) break;
      await dorme(500 * 2 ** i);
    }
  }
  throw ultimoErro;
}

// Anthropic (opcional). Retorna null se não houver chave — o chamador decide o fallback.
export async function anthropic(prompt, { maxTokens = 400, tentativas = 2 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return data.content?.[0]?.text ?? null;
    } catch (err) {
      ultimoErro = err;
      await dorme(500 * 2 ** i);
    }
  }
  console.warn("[llm] Anthropic falhou, seguindo sem resumo:", ultimoErro?.message);
  return null;
}

// Extrai JSON de uma resposta que pode vir com cercas de markdown.
export function parseJSON(texto) {
  const limpo = String(texto).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const m = limpo.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`Resposta não é JSON válido: ${limpo.slice(0, 200)}`);
  }
}
