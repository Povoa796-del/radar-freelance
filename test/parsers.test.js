// Testa os parsers INICIAIS/tolerantes (por padrão de URL) com HTML SINTÉTICO.
// Não é o HTML real do remetente — quando o real chegar em test/fixtures/, refinar
// cada parser e trocar por fixture real.
import { test } from "node:test";
import assert from "node:assert/strict";

import upwork from "../src/parsers/upwork.js";
import { parserPara } from "../src/parsers/index.js";
import gmailAlerts from "../src/sources/gmail-alerts.js";

test("parser upwork (tolerante): extrai vagas dos links de vaga, ignora conta/settings", () => {
  const html = `
    <a href="https://www.upwork.com/jobs/~012abc">Build a Node.js scraper</a>
    <a href="https://www.upwork.com/settings/billing">Billing</a>
    <a href="https://www.upwork.com/nx/wm/offer/123">React dashboard for SaaS</a>`;
  const vagas = upwork.parse(html);
  assert.equal(vagas.length, 2); // 2 links de vaga; 'settings' ignorado
  assert.equal(vagas[0].origem, "upwork");
  assert.match(vagas[0].url, /upwork\.com/);
  assert.ok(vagas[0].titulo.length > 3);
  assert.equal(vagas[0].empresa, undefined); // NUNCA inventa campo
  assert.equal(vagas[0].budget_min, undefined);
});

test("parser upwork: e-mail sem link de vaga → [] (descarta)", () => {
  assert.equal(upwork.parse('<a href="https://www.upwork.com/settings">Conta</a>').length, 0);
  assert.equal(upwork.parse("").length, 0);
});

test("parserPara roteia por remetente", () => {
  assert.equal(parserPara("Upwork <noreply@upwork.com>")?.nome, "upwork");
  assert.equal(parserPara("jobs-listings@linkedin.com")?.nome, "linkedin");
  assert.equal(parserPara("no-reply@workana.com")?.nome, "workana");
  assert.equal(parserPara("boletim@random.com"), null); // sem parser → descarte
});

test("gmail-alerts.normalize: RawJob do parser vira Vaga válida", () => {
  const v = gmailAlerts.normalize({ origem: "upwork", url: "https://www.upwork.com/jobs/~012", titulo: "Node.js scraper" });
  assert.equal(v.fonte, "upwork");
  assert.match(v.hash, /^[0-9a-f]{64}$/);
  assert.ok(v.fingerprint.includes("::"));
  assert.equal(v.budget_usd, null); // sem budget, nada inventado
});
