// Monta a Vaga canônica a partir dos campos-núcleo de cada fonte.
// Tudo aqui é puro e determinístico (sha256 incluso), para os normalize() serem testáveis.
import { createHash } from "node:crypto";
import { paraUSD, detectarMoeda } from "./moeda.js";

const TRACKING = /^(utm_|ref$|source$|src$|gh_|mc_|fbclid$|gclid$|campaign)/i;

export function stripHtml(texto) {
  return String(texto || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Extrai faixa salarial de texto livre: "$50k - $80k", "€60,000/year", "120-160k".
export function parseSalario(txt) {
  if (!txt) return { min: null, max: null, moeda: null };
  const moeda = detectarMoeda(txt);
  const nums = [...String(txt).matchAll(/(\d[\d.,]*)\s*(k)?/gi)]
    .map((m) => {
      let n = Number(m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
      if (m[2]) n *= 1000;
      return n;
    })
    .filter((n) => n >= 100); // descarta números pequenos soltos (anos, "3 anos")
  return { min: nums[0] ?? null, max: nums[1] ?? nums[0] ?? null, moeda };
}

export function slug(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// URL sem parâmetros de tracking, host minúsculo, sem barra/fragmento final.
export function urlCanonica(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.host = u.host.toLowerCase();
    for (const chave of [...u.searchParams.keys()]) {
      if (TRACKING.test(chave)) u.searchParams.delete(chave);
    }
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return String(url || "").trim();
  }
}

// Normaliza tipo de contrato -> 'freelance_fixo' | 'freelance_hora' | 'emprego'.
// `texto` (título/descrição) ajuda quando os metadados não marcam o regime — ex:
// título "LLM Engineer Freelancer" numa fonte que não traz job_type.
export function inferirTipo(rawTipo, salaryPeriod, texto = "") {
  const t = `${rawTipo || ""} ${texto || ""}`.toLowerCase();
  const p = String(salaryPeriod || "").toLowerCase();
  const ehGig = /\b(contract|contractor|freelance|freelancer|temporary|contrato|autonom|hourly|per.?hour|\bgig)\b/.test(t);
  if (ehGig) {
    return /hour|hora/.test(p) || /hourly|per.?hour|contractor/.test(t) ? "freelance_hora" : "freelance_fixo";
  }
  return "emprego";
}

// Converte datas variadas (ISO, unix s, unix ms, Date) para ISO string ou null.
export function paraISO(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor) ? null : valor.toISOString();
  if (typeof valor === "number") {
    const ms = valor < 1e12 ? valor * 1000 : valor;
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString();
  }
  const d = new Date(valor);
  return isNaN(d) ? null : d.toISOString();
}

export function montarVaga(campos) {
  const {
    fonte,
    fonte_id,
    url,
    titulo,
    empresa = null,
    descricao = null,
    skills = [],
    tipo = null,
    budget_min = null,
    budget_max = null,
    moeda = null,
    publicado_em = null,
    remoto = true,
    fuso_exigido = null,
    cliente_meta = {},
  } = campos;

  const urlC = urlCanonica(url);
  const hash = createHash("sha256").update(urlC).digest("hex");
  const fingerprint = `${slug(titulo)}::${slug(empresa)}`;

  const base = budget_max ?? budget_min;
  const budget_usd = base != null ? paraUSD(base, moeda) : null;

  return {
    fonte,
    fonte_id: String(fonte_id),
    url: urlC,
    titulo: String(titulo || "").trim(),
    empresa: empresa ? String(empresa).trim() : null,
    descricao: descricao ? String(descricao).trim() : null,
    skills: (Array.isArray(skills) ? skills : skills ? [skills] : []).filter(Boolean).map((s) => String(s).trim()),
    tipo,
    budget_min: budget_min != null ? Number(budget_min) : null,
    budget_max: budget_max != null ? Number(budget_max) : null,
    moeda: moeda || null,
    budget_usd,
    publicado_em: paraISO(publicado_em),
    remoto: remoto !== false,
    fuso_exigido: fuso_exigido || null,
    cliente_meta: cliente_meta || {},
    hash,
    fingerprint,
  };
}
