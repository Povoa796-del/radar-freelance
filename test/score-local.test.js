// Scoring do Radar Local Vigo — o ponto crítico é: sem experiência prática,
// então "exige 2+ años" derruba e "sin experiencia" sobe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pontuarLocal } from "../src/lib/score-local.js";
import adzunaLocal from "../src/sources/adzuna-local.js";
import joobleLocal from "../src/sources/jooble-local.js";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const perfil = JSON.parse(readFileSync(join(RAIZ, "src/config/perfil-local.json"), "utf8"));
const fx = (n) => JSON.parse(readFileSync(join(RAIZ, "test/fixtures", `${n}.json`), "utf8"));

test("adapters locais: normalize produz local-vaga válida (fixtures reais)", () => {
  const a = adzunaLocal.normalize(fx("adzuna"));
  assert.equal(a.fonte, "adzuna-local");
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.ok("local" in a && "tipo_contrato" in a);

  const j = joobleLocal.normalize(fx("jooble"));
  assert.equal(j.fonte, "jooble-local");
  assert.ok(j.titulo && j.url && j.hash);
});

test("score-local: mozo sin experiencia em z0 pontua alto", () => {
  const r = pontuarLocal(
    { titulo: "Mozo de almacén", empresa: "Log", local: "O Porriño", descricao: "Sin experiencia. Incorporación inmediata. Se valora portugués." },
    perfil
  );
  assert.equal(r.zona, "z0");
  assert.equal(r.experiencia, "sin experiencia");
  assert.ok(r.score >= 60, `esperado alto, veio ${r.score}`);
});

test("score-local: exige 2+ años derruba mesmo na área de formação", () => {
  const r = pontuarLocal(
    { titulo: "Técnico comercio exterior", empresa: "Y", local: "Vigo", descricao: "Imprescindible experiencia mínima de 3 años en aduanas." },
    perfil
  );
  assert.equal(r.experiencia, "exige experiencia");
  assert.ok(r.score < 60, `deveria ficar abaixo do corte, veio ${r.score}`);
  assert.equal(r.score_detalhe.componentes.exige_experiencia, -40);
});

test("score-local: 100% comisión + idioma faltante é negativo", () => {
  const r = pontuarLocal(
    { titulo: "Comercial", empresa: "Z", local: "Madrid", descricao: "100% comisión, sin salario fijo. Alemán imprescindible." },
    perfil
  );
  assert.ok(r.score < 0);
  assert.equal(r.zona, "fora");
});

test("score-local: veículo exigido é bônus com carro, penalidade sem", () => {
  const vaga = { titulo: "Repartidor", empresa: "A", local: "Vigo", descricao: "Carnet de conducir y vehículo propio." };
  assert.equal(pontuarLocal(vaga, perfil).score_detalhe.componentes.carnet_vehiculo, 10); // tem_veiculo:true
  assert.equal(pontuarLocal(vaga, { ...perfil, tem_veiculo: false }).score_detalhe.componentes.carnet_vehiculo, -15);
});
