// Contrato que toda fonte exporta. Falha em uma fonte nunca derruba o ciclo:
// 01-coletor.js envolve cada fetch() em try/catch e grava em fonte_saude.

/**
 * @typedef {Object} Vaga
 * @property {string}  fonte
 * @property {string}  fonte_id
 * @property {string}  url
 * @property {string}  titulo
 * @property {string|null} empresa
 * @property {string|null} descricao
 * @property {string[]} skills
 * @property {string|null} tipo            'freelance_fixo' | 'freelance_hora' | 'emprego'
 * @property {number|null} budget_min
 * @property {number|null} budget_max
 * @property {string|null} moeda
 * @property {number|null} budget_usd
 * @property {string|null} publicado_em
 * @property {boolean} remoto
 * @property {string|null} fuso_exigido
 * @property {object}  cliente_meta
 * @property {string}  hash
 * @property {string}  fingerprint
 */

/**
 * @typedef {Object} SourceAdapter
 * @property {string}  name
 * @property {boolean} enabled
 * @property {number}  rateLimitMs
 * @property {(ctx: {since: Date, keywords: string[], config: object}) => Promise<object[]>} fetch
 * @property {(raw: object) => Vaga} normalize
 */

export {};
