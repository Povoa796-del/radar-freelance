// Log mínimo com timestamp. Sem dependência.
function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
export function log(...args) {
  console.log(`[${ts()}]`, ...args);
}
export function warn(...args) {
  console.warn(`[${ts()}] ⚠️`, ...args);
}
export function erro(...args) {
  console.error(`[${ts()}] ❌`, ...args);
}
