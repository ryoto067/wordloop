# WordLoop

紙の単語帳の英単語を「何周も回して」確実に覚えるための PWA（スマホのホーム画面に追加して使うウェブアプリ）です。
1 周目はタイマーで時間を測りながら単語帳を回し、終わったら単語を入力。以降は間隔をあけた復習（1・3・7・14・30 日）と、文章での復習を行います。

## フォルダ構成

```
wordloop/
├── api/          Cloudflare Workers + Hono + D1（サーバー側）
│   ├── src/        API 本体
│   ├── migrations/ D1 のテーブル定義
│   ├── test/       API のテスト（vitest）
│   └── scripts/gen-vapid.mjs  通知用の鍵を作るスクリプト
├── web/          Vite + React の PWA（画面側）
│   ├── src/        画面・部品
│   ├── tests/      単体テスト（vitest）
│   ├── tests/e2e/  E2E テスト（Playwright）
│   └── vercel.json Vercel 用の設定（/api を Workers へ転送）
├── e2e-shots/    E2E で撮った各画面のスクリーンショット
└── docs/         設計書・計画
```

## ローカルで動かす

前提: Node.js 24、Windows の Git Bash か PowerShell。

1. 依存パッケージを入れる

   ```bash
   cd api && npm install && cd ../web && npm install
   ```

2. API の設定ファイルを作る（`.dev.vars` は Git に入りません）

   ```bash
   cd api
   cp .dev.vars.example .dev.vars
   ```

   `.dev.vars` を開き、次のようにします。Google ログインを使わないローカル確認なら、秘密情報はダミーで構いません。

   ```
   GOOGLE_CLIENT_ID=dummy
   GOOGLE_CLIENT_SECRET=dummy
   SESSION_SECRET=ローカル用の適当な長い文字列
   DEV_LOGIN=1
   ```

3. API を起動する（ポート 8787）

   ```bash
   cd api
   npx wrangler d1 migrations apply DB --local
   npx wrangler dev
   ```

4. 別のターミナルで画面を起動する（ポート 5173）

   ```bash
   cd web
   npm run dev
   ```

5. ブラウザで http://localhost:5173/login を開き、「開発用ログイン」にメールアドレス（例 `dev@example.com`）を入れて入ります。

## テスト

```bash
# API
cd api && npx vitest run && npx tsc --noEmit

# 画面の単体テスト
cd web && npx vitest run && npx tsc --noEmit

# E2E（スマホ幅 390×844 の Chromium）
cd web
npx playwright install chromium   # 初回のみ
npm run e2e
```

`npm run e2e` は API と画面を自動で起動します（すでに起動していればそれを使います）。
ログイン → 1 周目 → 復習 → 1 つ戻す → オフラインで採点 → オンラインに戻って送信、までを通し、各画面のスクリーンショットを `e2e-shots/` に保存します。
E2E は `api/.dev.vars` に `DEV_LOGIN=1` が必要です。

## デプロイ手順

**ここはオーナーが行う作業です。** ログイン、パスワード、秘密情報（鍵・シークレット）の入力はすべてオーナーご自身で行ってください。Claude に渡さないでください。

1. **Cloudflare の準備**（オーナー）

   ```bash
   cd api
   npx wrangler login
   npx wrangler d1 create wordloop
   ```

   出力された `database_id` を `api/wrangler.toml` の `database_id`（`local-placeholder` の行）に書き、続けて:

   ```bash
   npx wrangler d1 migrations apply wordloop --remote
   ```

2. **通知用の鍵（VAPID）を作り、秘密情報を登録**（オーナー）

   ```bash
   node scripts/gen-vapid.mjs
   ```

   表示された公開鍵・秘密鍵を使い、1 つずつ入力します（値は対話で貼り付けます）。

   ```bash
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT      # 例: mailto:あなたのメールアドレス
   npx wrangler secret put SESSION_SECRET     # 長いランダム文字列（例: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"）
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

   また `api/wrangler.toml` の `APP_ORIGIN` を本番の URL（手順 5 の Vercel ドメイン）に変更します。
   `DEV_LOGIN` は本番では**設定しないでください**。

3. **Google Cloud の OAuth クライアント作成**（オーナー）
   1. Google Cloud コンソールでプロジェクトを作り、「OAuth 同意画面」を作成します。公開状態は「テスト」のままにします。
   2. 「テストユーザー」にオーナーと、使ってもらう知人の Google アカウントを登録します。
   3. 「認証情報」→「OAuth クライアント ID」（ウェブアプリケーション）を作成し、承認済みリダイレクト URI に `https://<vercel ドメイン>/api/auth/google/callback` を登録します。
   4. 発行された クライアント ID / シークレットを、手順 2 の `wrangler secret put` で登録します。

4. **API をデプロイ**（オーナーの承認後）

   ```bash
   cd api
   npx wrangler deploy
   ```

   表示された `https://wordloop-api.<アカウント名>.workers.dev` を `web/vercel.json` の `<account>` 部分に書き込みます（`https://wordloop-api.<account>.workers.dev/api/:path*` の `<account>` を置き換え）。

5. **GitHub に push → Vercel**（オーナーの承認後）
   1. 変更を GitHub に push します。
   2. Vercel で「New Project」→ このリポジトリを選び、**Root Directory を `web`** にします（モノレポ全体を 1 リポジトリにしている場合は `projects/wordloop/web`）。
   3. デプロイ後の URL を、手順 2 の `APP_ORIGIN` と手順 3 のリダイレクト URI に反映し、必要なら `npx wrangler deploy` をやり直します。

6. **実機確認（iPhone / Android）**（オーナー）
   1. スマホのブラウザで URL を開き、「ホーム画面に追加」します（iPhone は Safari の共有メニューから）。
   2. ホーム画面のアイコンから起動し、Google でログインします（テストユーザー登録済みのアカウント）。
   3. 設定で通知を許可し、テスト通知が届くことを確認します。
   4. 機内モードで復習を 1 枚採点し、通信を戻すと送信されることを確認します。

> コミット・push・デプロイは、それぞれオーナーの確認のうえで実施します。
