// Testa normalize() de cada fonte contra um fixture real capturado da API.
// Se o schema da API mudar, estes testes quebram — que é o objetivo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import himalayas from "../src/sources/himalayas.js";
import remoteok from "../src/sources/remoteok.js";
import remotive from "../src/sources/remotive.js";
import jobicy from "../src/sources/jobicy.js";
import arbeitnow from "../src/sources/arbeitnow.js";
import hn from "../src/sources/hn-whoishiring.js";
import landingJobs from "../src/sources/landing-jobs.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const fixture = (nome) => JSON.parse(readFileSync(join(DIR, "fixtures", `${nome}.json`), "utf8"));

const HEX64 = /^[0-9a-f]{64}$/;
const TIPOS = new Set(["freelance_fixo", "freelance_hora", "emprego"]);

// Invariantes que TODA vaga normalizada deve respeitar.
function checarInvariantes(v, fonteEsperada) {
  assert.equal(v.fonte, fonteEsperada);
  assert.ok(v.fonte_id, "fonte_id vazio");
  assert.ok(v.titulo && v.titulo.length > 0, "titulo vazio");
  assert.ok(/^https?:\/\//.test(v.url), `url inválida: ${v.url}`);
  assert.match(v.hash, HEX64, "hash não é sha256 hex");
  assert.ok(v.fingerprint.includes("::"), "fingerprint sem separador");
  assert.ok(Array.isArray(v.skills), "skills não é array");
  assert.ok(TIPOS.has(v.tipo), `tipo inválido: ${v.tipo}`);
  assert.ok(v.budget_usd === null || typeof v.budget_usd === "number", "budget_usd inválido");
  assert.equal(typeof v.remoto, "boolean");
}

test("himalayas.normalize", () => {
  const v = himalayas.normalize(fixture("himalayas"));
  checarInvariantes(v, "himalayas");
  assert.ok(v.empresa, "himalayas deveria trazer empresa");
});

test("remoteok.normalize", () => {
  const v = remoteok.normalize(fixture("remoteok"));
  checarInvariantes(v, "remoteok");
  assert.equal(v.moeda, "USD");
});

test("remotive.normalize", () => {
  const v = remotive.normalize(fixture("remotive"));
  checarInvariantes(v, "remotive");
});

test("jobicy.normalize", () => {
  const v = jobicy.normalize(fixture("jobicy"));
  checarInvariantes(v, "jobicy");
});

test("arbeitnow.normalize", () => {
  const v = arbeitnow.normalize(fixture("arbeitnow"));
  checarInvariantes(v, "arbeitnow");
  assert.equal(v.budget_usd, null, "arbeitnow não publica salário");
});

test("hn-whoishiring.normalize", () => {
  const v = hn.normalize(fixture("hn-whoishiring"));
  checarInvariantes(v, "hn-whoishiring");
  // Post em prosa (sem cabeçalho pipe) não deve inventar budget.
  const temPipe = String(fixture("hn-whoishiring").text).includes("|");
  if (!temPipe) assert.equal(v.budget_usd, null, "HN em prosa não deveria ter budget");
});

test("landing-jobs.normalize", () => {
  const v = landingJobs.normalize(fixture("landing-jobs"));
  checarInvariantes(v, "landing-jobs");
  assert.equal(v.moeda, "EUR");
  assert.ok(v.empresa, "empresa deveria vir do slug da URL");
  assert.ok(v.cliente_meta.location, "location deveria ser preenchida");
});

test("normalize é determinístico (mesmo input -> mesmo hash)", () => {
  const a = himalayas.normalize(fixture("himalayas"));
  const b = himalayas.normalize(fixture("himalayas"));
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.skills, b.skills);
});
