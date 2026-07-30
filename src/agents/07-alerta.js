// 07 — alerta curado. Seleciona status 'novo' e score >= corte, ordena, corta em N.
// Se nada passa, NÃO manda nada (radar que manda mensagem vazia vira ruído).
import { candidatasAlertaTrilha, candidataSonda, atualizarScore, registrarAlerta } from "../lib/supabase.js";
import { enviarMensagem, esc, telegramConfigurado } from "../lib/telegram.js";
import { log, warn } from "../lib/log.js";

const SONDA_MIN = 50; // banda de exploração: [SONDA_MIN, scoreMinimo)

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
  const ehSonda = v.score_detalhe?.banda === "sonda";
  const linhas = [];
  if (ehSonda) linhas.push("🔬 <b>SONDA — abaixo do corte, me diz se presta</b>");
  linhas.push(
    `${ehSonda ? "🔬" : "🎯"} <b>${v.score} · ${esc(v.fonte)}</b>`,
    esc(v.titulo),
    `${esc(v.empresa || "—")} · ${budgetLabel(v)} · ${TIPO_LABEL[v.tipo] || "—"} · ${idadeRelativa(v.publicado_em)}`
  );
  // Linha geográfica só para presencial/híbrido (remoto não tem zona).
  const sd = v.score_detalhe || {};
  if (sd.zona) linhas.push(`📍 ${esc(sd.local || "")} · ${esc(sd.zona)} ${esc(sd.modalidade || "")}`.trim());
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
  // Banda 'alerta': cada trilha rankeada e cortada independentemente (score >= corte).
  const porTrilha = {};
  for (const [nome, cfg] of Object.entries(trilhas)) {
    const scoreMin = cfg.score_minimo ?? scoreMinimo;
    porTrilha[nome] = await candidatasAlertaTrilha(scoreMin, TIPOS_TRILHA[nome], cfg.max);
  }
  const alertaItens = Object.values(porTrilha).flat();
  for (const v of alertaItens) v.score_detalhe = { ...v.score_detalhe, banda: "alerta" };

  // Banda 'sonda': 1 item de maior score na faixa [50, corte) — braço de exploração.
  const sonda = await candidataSonda(SONDA_MIN, scoreMinimo);
  if (sonda) sonda.score_detalhe = { ...sonda.score_detalhe, banda: "sonda" };

  // Itens reais primeiro; a sonda por último, para não competir pela atenção.
  const selecionadas = [...alertaItens, ...(sonda ? [sonda] : [])];
  const resumo = `${Object.entries(porTrilha).map(([n, v]) => `${n}:${v.length}`).join(" ")} sonda:${sonda ? 1 : 0}`;

  if (!selecionadas.length) {
    log(`alerta: nada em nenhuma banda (${resumo}), não envio mensagem`);
    return { enviadas: 0 };
  }
  log(`alerta: ${resumo}`);

  if (!telegramConfigurado()) {
    warn(`alerta: Telegram não configurado; ${selecionadas.length} item(ns) ficariam de fora`);
    return { enviadas: 0, semTelegram: true, candidatas: selecionadas };
  }

  let enviadas = 0;
  const enviados = [];
  for (const v of selecionadas) {
    try {
      await enviarMensagem(formatarVaga(v), { botoes: botoes(v.id) });
      enviados.push(v);
      enviadas++;
    } catch (err) {
      warn(`alerta: falha ao enviar "${v.titulo?.slice(0, 40)}": ${err.message}`);
    }
  }

  // Persiste status 'alertado' + a banda (para separar as taxas no digest).
  for (const v of enviados) {
    await atualizarScore(v.id, { status: "alertado", score_detalhe: v.score_detalhe });
  }
  if (enviados.length) await registrarAlerta(enviados.map((v) => v.id));
  log(`alerta: ${enviadas} item(ns) enviado(s) (${resumo})`);
  return { enviadas };
}
