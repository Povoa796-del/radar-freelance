#!/usr/bin/env bash
# Publica o radar no GitHub e liga o workflow. RODE VOCÊ MESMO, após `gh auth login`.
# Os secrets são lidos do seu .env — você não digita valor nenhum à mão.
#
#   gh auth login          # (interativo, uma vez)
#   bash scripts/setup-github.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

# 0. Pré-requisitos
command -v gh >/dev/null || { echo "❌ gh não instalado (brew install gh)"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "❌ rode 'gh auth login' primeiro"; exit 1; }
[ -f .env ] || { echo "❌ .env não encontrado"; exit 1; }

# 1. Cria o repo privado + remote origin (pula se já existir)
if git remote get-url origin >/dev/null 2>&1; then
  echo "• remote origin já existe, pulando repo create"
else
  echo "• criando repo privado radar-freelance…"
  gh repo create radar-freelance --private --source=. --remote=origin
fi

# 2. Secrets a partir do .env (só os presentes e não-vazios)
set -a; source .env; set +a
for nome in SUPABASE_URL SUPABASE_SERVICE_KEY DEEPSEEK_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID ANTHROPIC_API_KEY; do
  valor="${!nome:-}"
  if [ -n "$valor" ]; then
    printf '%s' "$valor" | gh secret set "$nome"
    echo "• secret $nome definido"
  else
    echo "• $nome vazio no .env, pulando"
  fi
done

# 3. Push do código e das tags
echo "• enviando código e tags…"
git push -u origin main
git push origin --tags

# 4. Dispara o workflow e acompanha
echo "• disparando o workflow radar…"
gh workflow run radar
sleep 6
run_id="$(gh run list --workflow=radar --limit=1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
if [ -n "$run_id" ]; then
  gh run watch "$run_id" --exit-status || true
else
  echo "• run ainda não apareceu; acompanhe com: gh run watch"
fi
echo "✅ pronto."
