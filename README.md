# AI_SNS_School LP

「業務は10割AI、クリエイティブの3割で生きる」を掲げる AI スクール無料説明会用ランディングページ。

---

## ファイル構成

```
lp_template/
├── index.html              # 本番LP (公開ページ)
├── edit_ui.html            # ローカル編集UI (単独動作・代表専用)
├── edit_ui.css             # 編集UI スタイル
├── edit_ui.js              # 編集UI スクリプト
├── PLACEHOLDERS.md         # data-key マッピング表 (77変数・TBD 33件)
├── admin/                  # Decap CMS (共同編集用)
│   ├── index.html          # CMS 起動HTML
│   └── config.yml          # コレクション定義
├── DEPLOY.md               # デプロイ手順書 (GitHub + Cloudflare Pages + Worker OAuth)
└── README.md               # 本ファイル
```

---

## 編集インタフェースの使い分け

| 用途 | UI | 認証 | コミット先 | 推奨ユーザー |
|------|----|------|----------|------------|
| ローカル単独編集 (オフライン) | `edit_ui.html` | なし | ローカルファイルのみ | 代表 |
| Web上で共同編集 | `admin/index.html` (Decap CMS) | GitHub OAuth | GitHub → Cloudflare Pages 自動再デプロイ | 代表 + 編集メンバー2〜3名 |

### `edit_ui.html` (ローカル編集UI)
- ブラウザで開くだけで動作 (静的HTML)
- 編集結果は手動で `index.html` に反映が必要
- 代表が単独で素早く編集する用途

### `admin/index.html` (Decap CMS)
- 公開URL `https://[project].pages.dev/admin/` でアクセス
- GitHub アカウントでログイン (招待制)
- 編集 → 「Publish」で GitHub に commit → Pages 再デプロイ
- 共同編集前提

---

## デプロイ状態

| 環境 | 状態 |
|------|------|
| ローカル | 完了 (本ファイル群が作成済み) |
| GitHub | 未 (代表手動: DEPLOY.md Step 1〜2) |
| Cloudflare Pages | 未 (代表手動: DEPLOY.md Step 3) |
| GitHub OAuth App | 未 (代表手動: DEPLOY.md Step 4) |
| Cloudflare Worker | 未 (代表手動: DEPLOY.md Step 5) |
| 共同編集者招待 | 未 (代表手動: DEPLOY.md Step 7) |

詳細は `DEPLOY.md` を参照。

---

## 運用ガイド

### テキスト編集
1. `https://[project].pages.dev/admin/` を開く
2. GitHub ログイン
3. セクションを選んで編集
4. 「Publish」 → 自動的にGitHub commit + Cloudflare Pages 再デプロイ
5. 約 1〜2 分で本番に反映

### 編集者追加
1. GitHub リポジトリの Settings → Collaborators
2. GitHub ID で招待
3. 受諾後、`/admin/` にアクセスできる

### 編集者削除
1. GitHub Collaborators から削除
2. 即座にCMSアクセス不可となる

### バージョン管理
- 全編集は git commit として記録される
- 誤編集時は GitHub 上で revert 可能
- ブランチ運用は現状未対応 (main 直接編集)

---

## 既知の制約

1. **HTML側との連携は未実装**
   - CMS で編集する `site_data.json` を `index.html` に反映する仕組みが未構築
   - 現状は `index.html` 内の data-key を手動編集する必要あり
   - 次フェーズで JS埋め込み or ビルドスクリプトを実装予定

2. **画像差し替えは未対応**
   - テキスト編集中心の最小構成
   - 必要に応じて `admin/config.yml` に image widget を追加

3. **編集競合**
   - 同時編集時は後勝ち
   - 編集前に GitHub 最新を取得する運用が必要

---

## Cloudflare Worker コード

OAuth + パスワード認証 + GitHub保存用の Worker コード:
- ファイル: `_workers/worker_full.js`
- 配置場所: ルート外（`_workers/`配下）に置くことで、Cloudflare Pages/Workers の自動検出を回避
- 実際のデプロイ: Cloudflare ダッシュボードで `ai-sns-school-cms-oauth` Worker に手動貼り付け
- 自動デプロイ無効化推奨（管理画面で連携解除 or リポジトリ変更検知を停止）

---

## 関連ドキュメント

- `PLACEHOLDERS.md` — data-key 一覧と差し替え対応表 (TBD 33件含む)
- `DEPLOY.md` — デプロイ手順 (代表手動 7 ステップ)
- Decap CMS 公式: https://decapcms.org/
