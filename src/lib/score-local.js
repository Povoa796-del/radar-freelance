// Scoring do Radar Local Vigo — determinístico, critérios do brief.
// O ponto crítico: SEM experiência prática, então "exige 2+ años" penaliza forte,
// e "sin experiencia" pontua alto. Trabalho operacional é prioridade, não rebaixamento.
import { normalizarTexto } from "./jaccard.js";

function casa(hay, termo) {
  const t = normalizarTexto(termo);
  if (!t) return false;
  return new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(hay);
}

// Zona geográfica (z0 antes de z1; primeiro casa vence) + distância aproximada.
function localizacao(texto, perfil) {
  const hay = normalizarTexto(texto);
  for (const cidade of perfil.zonas.z0 || []) if (casa(hay, cidade)) return { zona: "z0", cidade };
  for (const cidade of perfil.zonas.z1 || []) if (casa(hay, cidade)) return { zona: "z1", cidade };
  return { zona: "fora", cidade: null };
}

// Detecção de exigência de experiência (accent-insensitive).
const RE_SEM_EXP = /\b(sin experiencia|no se requiere experiencia|experiencia no (necesaria|requerida)|no es necesaria experiencia|se valorara( la)? experiencia)\b/;
const RE_EXIGE_EXP = /\b((\d+)\s*a[nñ]?os? de experiencia|experiencia (minima|imprescindible|necesaria|requerida|demostrable)|imprescindible experiencia|se requiere experiencia)\b/;
const RE_PORTUGUES = /\b(portugues|portugal|brasil|brasileno|mercado luso)\b/;
const RE_AREA = /\b(comercio exterior|aduanas|logistica internacional|exportacion|importacion|transitaria|comex)\b/;
const RE_INMEDIATA = /\b(incorporacion inmediata|inicio inmediato|contrato inmediato|se incorpora ya|incorporacion inmediata)\b/;
const RE_UNIVERSITARIA = /\b(universitari|grado|licenciatura|diplomatura|mba|master|formacion superior)\b/;
const RE_CARNET = /\b(carnet de conducir|carne de conducir|permiso de conducir|vehiculo propio|coche propio)\b/;
const RE_IDIOMA_FALTANTE = /\b(aleman|frances|galego (escrito|formal)|italiano|chino)\b/;
const RE_COMISSAO = /\b(100% comision|solo comision|solo a comision|sin salario fijo|a comision pura|unicamente comision)\b/;

export function pontuarLocal(vaga, perfil) {
  const texto = normalizarTexto(`${vaga.titulo || ""} ${vaga.empresa || ""} ${vaga.local || ""} ${vaga.descricao || ""}`);
  const p = perfil.pesos;
  const comp = {};

  const loc = localizacao(`${vaga.local || ""} ${vaga.titulo || ""} ${vaga.descricao || ""}`, perfil);
  if (loc.zona === "z0") comp.z0 = p.z0;
  else if (loc.zona === "z1") comp.z1 = p.z1;

  const semExp = RE_SEM_EXP.test(texto);
  const exigeExp = !semExp && RE_EXIGE_EXP.test(texto);
  let experiencia = null;
  if (semExp) {
    comp.sem_experiencia = p.sem_experiencia;
    experiencia = "sin experiencia";
  } else if (exigeExp) {
    comp.exige_experiencia = p.exige_experiencia;
    experiencia = "exige experiencia";
  }

  if (RE_PORTUGUES.test(texto)) comp.portugues_valor = p.portugues_valor;
  if (RE_AREA.test(texto)) comp.area_formacao = p.area_formacao;
  if (RE_INMEDIATA.test(texto)) comp.incorporacion_inmediata = p.incorporacion_inmediata;
  if (RE_UNIVERSITARIA.test(texto)) comp.formacao_universitaria = p.formacao_universitaria;
  // Veículo próprio: se tenho carro, exigi-lo é BÔNUS (filtra concorrência sem carro);
  // se não tenho, é penalidade.
  if (RE_CARNET.test(texto)) comp.carnet_vehiculo = perfil.tem_veiculo ? (p.carnet_bonus ?? 10) : p.carnet_vehiculo;
  if (RE_IDIOMA_FALTANTE.test(texto)) comp.idioma_faltante = p.idioma_faltante;
  if (RE_COMISSAO.test(texto)) comp.comissao_100 = p.comissao_100;

  const score = Object.values(comp).reduce((a, b) => a + b, 0);
  const dist = loc.cidade ? perfil.distancia_km?.[loc.cidade] ?? null : null;

  return {
    score,
    zona: loc.zona,
    cidade: loc.cidade,
    distancia_km: dist,
    experiencia,
    score_detalhe: { componentes: comp },
  };
}
