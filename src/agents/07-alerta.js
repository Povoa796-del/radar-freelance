// 07 — alerta curado. Seleciona status 'novo' e score >= corte, ordena, corta em N.
// Se nada passa, NÃO manda nada (radar que manda mensagem vazia vira ruído).
import { candidatasAlertaTrilha, marcarStatus, registrarAlerta } from "../lib/supabase.js";
import { enviarMensagem, esc, telegramConfigurado } from "../lib/telegram.js";
import { log, warn } from "../lib/log.js";

const TIPOS_TRILHA = {
  freelance: ["freelance_fixo", "freelance_hora"],
  emprego: ["emprego"],
};

const TIPO_LABEL = { freelance_fixo: "fixo", freelance_hora: "hora", emprego: "emprego" };

function idadeRelativa(iso) {
  if (!iso) return "";
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return "agora há pouco";
  if (h < 24) return `há ${Math.round(h)}h`;
  return `há ${Math.round(h / 24)}d`;
}

function budgetLabel(v) {
  if (v.budget_usd == null) return "sem budget";
  const usd = `US$ ${Number(v.budget_usd).toLocaleString("pt-BR")}`;
  // Se a faixa original tem min≠max, mostra a faixa na moeda de origem + o teto em USD.
  if (v.budget_min && v.budget_max && v.budget_min !== v.budget_max && v.moeda) {
    const faixa = `${Number(v.budget_min).toLocaleString("pt-BR")}–${Number(v.budget_max).toLocaleString("pt-BR")} ${v.moeda}`;
    return v.moeda === "USD" ? faixa : `${faixa} (~${usd})`;
  }
  return usd;
}

export function formatarVaga(v) {
  const a = v.llm_analise || {};
  const linhas = [
    `🎯 <b>${v.score} · ${esc(v.fonte)}</b>`,
    esc(v.titulo),
    `${esc(v.empresa || "—")} · ${budgetLabel(v)} · ${TIPO_LABEL[v.tipo] || "—"} · ${idadeRelativa(v.publicado_em)}`,
  ];
  if (a.necessidade_real) linhas.push("", esc(a.necessidade_real));
  if (a.viabilidade_agentes) {
    linhas.push(`<b>Viabilidade:</b> ${esc(a.viabilidade_agentes)} — ${esc(a.justificativa_viabilidade || "")}`);
  }
  if (a.esforco_horas_estimado) linhas.push(`<b>Esforço:</b> ~${esc(a.esforco_horas_estimado)}h`);
  if (a.risco_principal) linhas.push(`<b>Risco:</b> ${esc(a.risco_principal)}`);
  // Budget ausente não penaliza o score (v2) — é exibido para você decidir.
  if (v.budget_usd == null) linhas.push("⚠️ budget não publicado — negociar escopo antes");
  linhas.push("", `🔗 ${esc(v.url)}`);
  return linhas.join("\n");
}

function botoes(id) {
  return [
    [
      { text: "✅ Interesse", callback_data: `int:${id}` },
      { text: "🗑 Descartar", callback_data: `desc:${id}` },
    ],
  ];
}

export async function alertar({ scoreMinimo = 70, trilhas = { freelance: { max: 3 }, emprego: { max: 2 } } } = {}) {
  // Cada trilha é rankeada e cortada independentemente — não competem no mesmo ranking.
  const porTrilha = {};
  for (const [nome, cfg] of Object.entries(trilhas)) {
    const scoreMin = cfg.score_minimo ?? scoreMinimo;
    porTrilha[nome] = await candidatasAlertaTrilha(scoreMin, TIPOS_TRILHA[nome], cfg.max);
  }
  const candidatas = Object.values(porTrilha).flat();

  const resumoTrilhas = Object.entries(porTrilha).map(([n, v]) => `${n}:${v.length}`).join(" ");
  if (!candidatas.length) {
    log(`alerta: nada com score >= ${scoreMinimo} em nenhuma trilha (${resumoTrilhas}), não envio mensagem`);
    return { enviadas: 0 };
  }
  log(`alerta: candidatas por trilha → ${resumoTrilhas}`);

  if (!telegramConfigurado()) {
    warn(`alerta: Telegram não configurado; ${candidatas.length} oportunidades ficariam de fora`);
    return { enviadas: 0, semTelegram: true, candidatas };
  }

  let enviadas = 0;
  const idsOk = [];
  for (const v of candidatas) {
    try {
      await enviarMensagem(formatarVaga(v), { botoes: botoes(v.id) });
      idsOk.push(v.id);
      enviadas++;
    } catch (err) {
      warn(`alerta: falha ao enviar "${v.titulo?.slice(0, 40)}": ${err.message}`);
    }
  }

  if (idsOk.length) {
    await marcarStatus(idsOk, "alertado");
    await registrarAlerta(idsOk);
  }
  log(`alerta: ${enviadas} oportunidade(s) enviada(s)`);
  return { enviadas };
}
