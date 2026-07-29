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

  const altas = vagas.filter((v) => (v.score || 0) >= 70);
  const alertadas = vagas.filter((v) => v.status !== "novo");
  const interesse = vagas.filter((v) => ["interesse", "aplicado", "resposta", "ganho"].includes(v.status));
  const scoreMedio = total ? (vagas.reduce((a, v) => a + (v.score || 0), 0) / total).toFixed(1) : "0";
  const topSkills = contarSkills(altas).slice(0, 3);
  const taxaInteresse = alertadas.length ? ((interesse.length / alertadas.length) * 100).toFixed(0) : "0";

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
- Alertadas: **${alertadas.length}** · marcadas "interesse+": **${interesse.length}** (${taxaInteresse}%)

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
      `Alertadas: ${alertadas.length} · interesse: ${interesse.length} (${taxaInteresse}%)`,
      "",
      `<b>Top skills (score alto):</b> ${topSkills.map(([s]) => esc(s)).join(", ") || "—"}`,
      `<b>Fontes:</b> ${Object.entries(porFonte).map(([f, n]) => `${esc(f)} ${n}`).join(" · ") || "—"}`,
    ].join("\n");
    await enviarMensagem(resumo);
  }
  return { arquivo, total, altas: altas.length };
}
