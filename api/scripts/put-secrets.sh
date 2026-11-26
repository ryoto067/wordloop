#!/usr/bin/env bash
# 本番用の秘密情報（VAPID 鍵・セッション用シークレット）を生成し、
# 画面に表示せずに Cloudflare に登録する。Git Bash で実行:
#   cd projects/wordloop/api && bash scripts/put-secrets.sh
# ※ 実行するたびに鍵が変わる（通知の購読は登録し直しになる）。最初の 1 回だけ実行すること。
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=$(node scripts/gen-vapid.mjs)
PUB=$(printf '%s\n' "$OUT" | sed -n 's/^VAPID_PUBLIC_KEY=//p')
PRIV=$(printf '%s\n' "$OUT" | sed -n 's/^VAPID_PRIVATE_KEY=//p')
SESS=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")

printf '%s' "$PUB"  | npx wrangler secret put VAPID_PUBLIC_KEY
printf '%s' "$PRIV" | npx wrangler secret put VAPID_PRIVATE_KEY
printf '%s' "https://github.com/ryoto067/wordloop" | npx wrangler secret put VAPID_SUBJECT
printf '%s' "$SESS" | npx wrangler secret put SESSION_SECRET

unset OUT PRIV SESS
echo "完了: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT / SESSION_SECRET を登録しました"
