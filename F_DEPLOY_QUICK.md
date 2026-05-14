# F案 クイックデプロイ手順（代表用・即実行版）

**所要時間: 約 30 分** / 編集者1人運用 / パスワード定期ローテーション方針

実行順に上から進めるだけで完了する。詳細解説は `DEPLOY.md` の Step 8〜11 を参照。

---

## 前提

- Cloudflare Worker `ai-sns-school-cms-oauth` が既にデプロイされている (既存 OAuth プロキシ動作中)
- GitHub リポジトリ `shotaso1124/haruki_the_dance` が main ブランチで運用中
- 編集 UI ファイル (`edit_ui.html` / `edit_ui.js` / `edit_ui.css` / `index.html`) がリポジトリの **ルート直下**に存在
- ローカル: `/Users/shota/Claude母体/ai_sns_school/lp_template/` で作業

---

## ① GitHub PAT を発行 (5分)

1. https://github.com/settings/tokens?type=beta を開く
2. 「Generate new token」
3. 入力:
   - Token name: `ai-sns-school-cms-write`
   - Expiration: **90 days**
   - Repository access: **Only select repositories** → `shotaso1124/haruki_the_dance`
   - Repository permissions: **Contents: Read and write** のみ
4. 「Generate token」→ 表示された `github_pat_xxx...` を **コピーして保管**（1回しか出ない）

---

## ② SESSION_SECRET を生成 (1分)

ターミナルで:

```bash
openssl rand -hex 32
```

出力された **64文字の16進文字列** をコピーして保管。

---

## ③ パスワードを決める (1分)

任意の強いパスワード（16文字以上推奨）。例:

```
Spring2026-AiCmsLP-Edit!
```

---

## ④ Cloudflare Worker に Secret を 3 つ登録 (5分)

[Cloudflare ダッシュボード](https://dash.cloudflare.com/) で:

1. Workers & Pages → `ai-sns-school-cms-oauth` を開く
2. Settings → **Variables and Secrets**
3. 以下 3 つを順に「Add」（必ず Type = **Secret** にする）:

| Name | Value |
|------|-------|
| `GITHUB_PAT` | ① でコピーした PAT |
| `SHARED_PASSWORD` | ③ で決めたパスワード |
| `SESSION_SECRET` | ② で生成した 64文字列 |

> 既存の `CLIENT_ID` / `CLIENT_SECRET` はそのまま残す。削除しない。

---

## ⑤ Worker コードを差し替える (5分)

1. 同じ Worker の左メニュー「**Edit code**」をクリック
2. エディタ全選択 → **すべて削除**
3. ローカルの `/Users/shota/Claude母体/ai_sns_school/lp_template/worker_full.js` を開き、**全文コピペ**
4. 右上「**Deploy**」をクリック

---

## ⑥ edit_ui.html / edit_ui.js / worker_full.js を GitHub に push (3分)

ターミナルで:

```bash
cd /Users/shota/Claude母体/ai_sns_school/lp_template
git add edit_ui.html edit_ui.js worker_full.js DEPLOY.md F_DEPLOY_QUICK.md
git commit -m "feat: F案 (password auth + GitHub direct save) を追加"
git push
```

> push しないと Worker が新しい `edit_ui.html` を `raw.githubusercontent.com` から取得できない。

---

## ⑦ 動作確認 (5分)

1. ブラウザで以下を開く:

   ```
   https://ai-sns-school-cms-oauth.shotso1124.workers.dev/edit
   ```

2. パスワード入力画面が出る → ③ のパスワードを入力 → 「ログイン」

3. 編集 UI が表示される

4. 試しに「ヒーローセクション」のサブコピー (`hero_sub`) を変更

5. 右上「**GitHubに保存（公開）**」ボタンをクリック

6. 確認ダイアログ → OK

7. 「GitHub に保存しました (xxxxxxx)」と緑文字表示 → コミットURLを開いて反映確認

8. 1〜2 分後、`https://aischool.shotso1124.workers.dev/` に変更が反映される

---

## ⑧ リグレッション確認 (任意・2分)

既存の Decap CMS 経路も生きているかチェック:

1. `https://[Pagesプロジェクト].pages.dev/admin/` を開く
2. 「Login with GitHub」が動作することを確認

---

## ローテーション運用（推奨）

- **90日ごと**: GitHub PAT を再発行 → `GITHUB_PAT` Secret を上書き更新（Worker 再デプロイ不要、Secret 保存だけで即反映）
- **代表交代時 / 退職時**: `SHARED_PASSWORD` をその場で変更 → 旧パスワードは即無効化
- **インシデント時**: `SESSION_SECRET` を再生成 → 全セッションが即時切断される

---

## トラブル時のチェックリスト

| 症状 | チェック |
|------|---------|
| `/edit` で 500 エラー | Worker の Logs を見て `SHARED_PASSWORD / SESSION_SECRET not configured` ならば Secret 未登録 |
| ログイン後すぐ `/login` に戻る | Cookie が SameSite=Strict で弾かれていないか / Worker URL を直打ちでアクセスしているか |
| 「GitHubに保存」で 401 | セッション切れ (8時間経過) → 再ログイン |
| 「GitHubに保存」で 422 / Bad credentials | `GITHUB_PAT` の Contents 権限・対象リポジトリ設定を再確認 |
| 「GitHubに保存」で 409 (sha 不一致) | 別経路で同ファイルが更新済み → 編集画面を再読込してから再保存 |
| 編集画面の CSS / JS が崩れている | リポジトリに `edit_ui.css` / `edit_ui.js` が存在するか / push 漏れがないか |

---

## 最初に何をするか（一言で）

**まず ① GitHub PAT 発行 → ② openssl で SESSION_SECRET 生成 → ③ パスワード決定 → ④ Cloudflare で Secret 3つ登録 → ⑤ Worker コードを worker_full.js で上書き Deploy → ⑥ git push → ⑦ `/edit` を開いて動作確認。**

詰まったら `DEPLOY.md` の Step 8〜11 を参照。
