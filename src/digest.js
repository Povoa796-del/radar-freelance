// Digest semanal: relatório em reports/YYYY-WW.md + resumo no Telegram.
// Responde a duas perguntas: qual fonte manter ligada e qual skill o mercado pede.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { estatisticasSemana } from "./lib/supabase.js";
import { enviarMensagem, esc, telegramConfigurado } from "./lib/telegram.js";
import { log } from "./lib/log.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

function semanaISO(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dia);
  const inicioAno = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((dt - inicioAno) / 864e5 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}

function contarSkills(vagas) {
  const cont = {};
  for (const v of vagas) for (const s of v.skills || []) cont[s] = (cont[s] || 0) + 1;
  return Object.entries(cont).sort((a, b) => b[1] - a[1]);
}

export async function gerarDigest() {
  const { vagas, saude } = await estatisticasSemana(7);
  const total = vagas.length;
  const porFonte = {};
  for (const v of vagas) porFonte[v.fonte] = (porFonte[v.fonte] || 0) + 1;

  const INTERESSE = ["interesse", "aplicado", "resposta", "ganho"];
  const pontuadas = vagas.filter((v) => v.score != null);
  const altas = pontuadas.filter((v) => v.score >= 70);
  const scoreMedio = pontuadas.length
    ? (pontuadas.reduce((a, v) => a + v.score, 0) / pontuadas.length).toFixed(1)
    : "0";
  const topSkills = contarSkills(altas).slice(0, 3);

  // Foi ao alerta se tem banda gravada. Taxa de interesse separada por banda.
  const enviadas = vagas.filter((v) => v.score_detalhe?.banda);
  const taxaBanda = (banda) => {
    const sent = enviadas.filter((v) => v.score_detalhe.banda === banda);
    const inter = sent.filter((v) => INTERESSE.includes(v.status));
    return { sent: sent.length, inter: inter.length, pct: sent.length ? Math.round((inter.length / sent.length) * 100) : 0 };
  };
  const tAlerta = taxaBanda("alerta");
  const tSonda = taxaBanda("sonda");

  const semana = semanaISO();
  const linhasFonte = Object.entries(porFonte)
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `| ${f} | ${n} |`)
    .join("\n");
  const linhasSaude = saude
    .map((s) => `| ${s.fonte} | ${s.itens_ultima_run ?? "-"} | ${s.erros_seguidos || 0} | ${s.ultimo_erro ? "⚠️" : "ok"} |`)
    .join("\n");

  const md = `# Digest ${semana}

- Vagas coletadas (7d): **${total}**
- Passaram para score alto (≥70): **${altas.length}**
- Score médio: **${scoreMedio}**

## Taxa de interesse por banda
| Banda | Enviadas | Interesse | Taxa |
|---|---|---|---|
| alerta (≥70) | ${tAlerta.sent} | ${tAlerta.inter} | ${tAlerta.pct}% |
| sonda (50–69) | ${tSonda.sent} | ${tSonda.inter} | ${tSonda.pct}% |

> Sonda com taxa próxima ou acima da alerta = o corte 70 está alto demais para esse tipo.
> Sonda perto de zero = o corte está protegendo bem sua atenção.

## Por fonte
| Fonte | Coletadas |
|---|---|
${linhasFonte || "| — | 0 |"}

## Top skills nas vagas de score alto
${topSkills.map(([s, n]) => `- ${s} (${n})`).join("\n") || "- (nenhuma)"}

## Saúde das fontes
| Fonte | Última run | Erros seguidos | Estado |
|---|---|---|---|
${linhasSaude || "| — | - | - | - |"}
`;

  mkdirSync(join(RAIZ, "reports"), { recursive: true });
  const arquivo = join(RAIZ, "reports", `${semana}.md`);
  writeFileSync(arquivo, md);
  log(`digest: gravado ${arquivo}`);

  if (telegramConfigurado()) {
    const resumo = [
      `📊 <b>Digest ${semana}</b>`,
      `Coletadas: ${total} · score alto: ${altas.length} · médio: ${scoreMedio}`,
      `🎯 alerta (≥70): ${tAlerta.inter}/${tAlerta.sent} interesse (${tAlerta.pct}%)`,
      `🔬 sonda (50–69): ${tSonda.inter}/${tSonda.sent} interesse (${tSonda.pct}%)`,
      "",
      `<b>Top skills (score alto):</b> ${topSkills.map(([s]) => esc(s)).join(", ") || "—"}`,
      `<b>Fontes:</b> ${Object.entries(porFonte).map(([f, n]) => `${esc(f)} ${n}`).join(" · ") || "—"}`,
    ].join("\n");
    // O .md já foi gravado; uma falha no Telegram não deve derrubar o digest.
    try {
      await enviarMensagem(resumo);
    } catch (err) {
      log(`digest: resumo no Telegram falhou (${err.message}); relatório em ${arquivo}`);
    }
  }
  return { arquivo, total, altas: altas.length };
}
