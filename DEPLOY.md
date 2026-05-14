# AI_SNS_School LP デプロイ手順書

Decap CMS による共同編集環境を構築する手順。
GitHub + Cloudflare Pages + Cloudflare Workers (OAuth プロキシ) の構成。

---

## 構成図

```
[編集者] ──Web UI──> admin/index.html (Decap CMS)
                        │
                        │ OAuth認証
                        ▼
                     Cloudflare Worker (OAuth プロキシ)
                        │
                        │ GitHub OAuth API
                        ▼
                     GitHub リポジトリ (main branch)
                        │
                        │ push 検知 → 自動再デプロイ
                        ▼
                     Cloudflare Pages (公開URL)
```

---

## 推定所要時間

代表が本書に沿って進める場合: **約 60〜90 分**
(GitHub OAuth App 設定 + Cloudflare Worker デプロイで 30〜45 分が中心)

---

## 代表手動ステップ一覧 (合計 7 ステップ)

| # | ステップ | 所要時間 | 必要なもの |
|---|---------|---------|----------|
| 1 | GitHub リポジトリ作成 | 5 分 | GitHub アカウント |
| 2 | ローカルから push | 10 分 | git 環境 |
| 3 | Cloudflare Pages 連携 | 10 分 | Cloudflare アカウント |
| 4 | GitHub OAuth App 作成 | 10 分 | (Step 1 のリポジトリURL) |
| 5 | Cloudflare Worker デプロイ (OAuthプロキシ) | 20 分 | wrangler CLI or ダッシュボード |
| 6 | config.yml にURL反映 | 5 分 | エディタ |
| 7 | Collaborator 招待 + 動作確認 | 10 分 | 編集者の GitHub ID |

---

## Step 1: GitHub リポジトリ作成

代表手動:
1. https://github.com/new を開く
2. Repository name: `ai-sns-school-lp` (任意)
3. **Public** または **Private** を選択 (Private 推奨)
4. README は初期化しない (空リポジトリで作成)
5. 「Create repository」をクリック
6. 表示される `https://github.com/[user]/ai-sns-school-lp.git` をメモ

---

## Step 2: ローカルから GitHub へ push

代表手動 (ターミナルで実行):

```bash
cd /Users/shota/Claude母体/ai_sns_school/lp_template

# git 初期化 (既に初期化済みならスキップ)
git init
git branch -M main

# ファイルをコミット
git add .
git commit -m "initial commit: AI_SNS_School LP + Decap CMS"

# GitHub にひも付け (Step 1 のURLに置き換え)
git remote add origin https://github.com/[user]/ai-sns-school-lp.git
git push -u origin main
```

push が成功すれば、ブラウザでリポジトリ画面にファイルが並ぶ。

---

## Step 3: Cloudflare Pages にデプロイ

代表手動:
1. https://dash.cloudflare.com/?to=/:account/pages を開く
2. 「Create application」→「Pages」→「Connect to Git」
3. GitHub を連携 (初回のみ Cloudflare に GitHub アクセス許可)
4. Step 1 で作成したリポジトリを選択
5. ビルド設定:
   - Framework preset: **None**
   - Build command: (空欄でOK)
   - Build output directory: `/` (ルート)
6. 「Save and Deploy」をクリック
7. デプロイ完了後、`https://[project].pages.dev` がメモ対象

**動作確認**: `https://[project].pages.dev/` で LP 本体が表示されること。

---

## Step 4: GitHub OAuth App 作成

代表手動:
1. https://github.com/settings/developers を開く
2. 「OAuth Apps」→「New OAuth App」
3. 入力:
   - Application name: `AI_SNS_School LP CMS` (任意)
   - Homepage URL: `https://[project].pages.dev` (Step 3 のURL)
   - Authorization callback URL: `https://[worker].workers.dev/callback`
     - `[worker]` は Step 5 で決める Worker サブドメイン名(まだない場合は仮値、後で更新)
4. 「Register application」
5. 表示される **Client ID** をメモ
6. 「Generate a new client secret」をクリック → **Client Secret** をメモ
   - Secret は一度しか表示されないので必ず控える

---

## Step 5: Cloudflare Worker で OAuth プロキシをデプロイ

Decap CMS は v3 以降 Netlify Identity 廃止のため、自前で OAuth プロキシを用意する。
ここでは最も手軽な **Cloudflare Workers** を使う。

### 5-1. Worker 作成

代表手動 (Cloudflare ダッシュボード):
1. https://dash.cloudflare.com/?to=/:account/workers-and-pages を開く
2. 「Create」→「Create Worker」
3. 名前: `ai-sns-school-cms-oauth` (任意) → サブドメインが決まる: `ai-sns-school-cms-oauth.[your].workers.dev`
4. 「Deploy」(デフォルトテンプレートで一度デプロイ)

### 5-2. Worker コード差し替え

「Edit code」を開き、以下のコードに丸ごと置き換える:

```javascript
// Decap CMS GitHub OAuth プロキシ (Cloudflare Workers)
// 参考: https://decapcms.org/docs/external-oauth-clients/

const CLIENT_ID = "YOUR_GITHUB_CLIENT_ID";          // Step 4 の値
const CLIENT_SECRET = "YOUR_GITHUB_CLIENT_SECRET";  // Step 4 の値
const SCOPE = "repo,user";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // /auth → GitHub OAuth 画面へリダイレクト
    if (url.pathname === "/auth") {
      const redirect = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPE}`;
      return Response.redirect(redirect, 302);
    }

    // /callback → アクセストークン交換 → Decap CMS に postMessage
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("missing code", { status: 400 });

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
      });
      const data = await tokenRes.json();

      const payload = data.access_token
        ? { token: data.access_token, provider: "github" }
        : { error: data.error || "unknown" };
      const message = `authorization:github:${data.access_token ? "success" : "error"}:${JSON.stringify(payload)}`;

      const html = `<!DOCTYPE html><html><body><script>
        (function() {
          function receive(e) {
            window.opener.postMessage(${JSON.stringify(message)}, e.origin);
            window.removeEventListener("message", receive);
          }
          window.addEventListener("message", receive, false);
          window.opener.postMessage("authorizing:github", "*");
        })();
      </script></body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    return new Response("Decap CMS OAuth Proxy: OK");
  },
};
```

### 5-3. Secret 設定 (推奨: コード直書きを避ける)

実運用では `CLIENT_ID` / `CLIENT_SECRET` を Workers の Environment Variables に格納:
1. Worker 設定 → 「Variables」→「Add variable」
2. 「Encrypt」にチェックを入れて Secret として保存
3. コード側を `env.CLIENT_ID` / `env.CLIENT_SECRET` 参照に書き換える

### 5-4. デプロイ

「Deploy」をクリック。Worker URL: `https://ai-sns-school-cms-oauth.[your].workers.dev` をメモ。

### 5-5. GitHub OAuth App のコールバックURL更新

Step 4 の OAuth App に戻り、Authorization callback URL を実際の Worker URL に更新:
`https://ai-sns-school-cms-oauth.[your].workers.dev/callback`

---

## Step 6: admin/config.yml にURLを反映

代表手動 (ローカル編集):

`admin/config.yml` を開き、以下の3箇所のプレースホルダーを置換:

```yaml
backend:
  name: github
  repo: [user]/ai-sns-school-lp                                       # ← Step 1
  branch: main
  base_url: https://ai-sns-school-cms-oauth.[your].workers.dev         # ← Step 5
  auth_endpoint: /auth

site_url: https://[project].pages.dev                                  # ← Step 3
display_url: https://[project].pages.dev                               # ← Step 3
```

変更後、git push:

```bash
cd /Users/shota/Claude母体/ai_sns_school/lp_template
git add admin/config.yml
git commit -m "config: set deploy URLs"
git push
```

Cloudflare Pages が自動的に再デプロイする (1〜2分)。

---

## Step 7: 編集者を招待 + 動作確認

### 7-1. GitHub Collaborator 招待

代表手動:
1. GitHub リポジトリの「Settings」→「Collaborators」
2. 「Add people」→ 編集者の GitHub アカウントを入力
3. 招待メールが編集者に届く → 受諾してもらう

### 7-2. 動作確認

1. `https://[project].pages.dev/admin/` をブラウザで開く
2. 「Login with GitHub」をクリック
3. GitHub の認証画面が出る → 承認
4. CMS 編集画面が表示されれば成功
5. 試しに「① ヒーローセクション」のサブコピーを編集 → 「Publish」
6. GitHub にコミットが入り、Cloudflare Pages が再デプロイされることを確認

### 7-3. 編集者にも同じURLを共有

`https://[project].pages.dev/admin/` を編集者に伝える。
編集者は自分の GitHub アカウントでログインして編集可能。

---

## 既知の制約

1. **HTML側のデータ反映は別途実装が必要**
   - 現状 `index.html` は data-key にハードコード済み
   - `site_data.json` を CMS で編集しても自動反映されない
   - 別途、ビルドスクリプト or JS によるランタイム埋め込みが必要 (次フェーズ)

2. **画像差し替えは現状未対応**
   - 画像ウィジェットは未定義 (collections に追加すれば対応可能)

3. **公開プレビューは Pages 反映後**
   - エディタ内ライブプレビューはオフ (`show_preview_links: false`)

4. **OAuth プロキシは代表所有の Cloudflare アカウント依存**
   - 編集者の追加には GitHub Collaborator 招待が必要

5. **Decap CMS は client-side authentication**
   - Client Secret を Worker に置く設計のため、Worker のアクセス制御は別途検討
   - 招待制 (Collaborator のみ書き込み可) で運用上の問題は出にくい

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| `/admin/` で白画面 | ブラウザコンソールを確認。`config.yml` のYAML構文エラーの可能性 |
| Login with GitHub で「redirect_uri mismatch」 | OAuth App のコールバックURLと Worker URL が一致しているか確認 |
| CMS に入れるが Publish で失敗 | リポジトリ書き込み権限がない (Collaborator 招待を受諾しているか) |
| 編集が反映されない | Cloudflare Pages のビルドログを確認 (Pages → 該当プロジェクト → Deployments) |
