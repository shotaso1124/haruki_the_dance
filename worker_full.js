// ============================================================
// AI_SNS_School CMS Worker
//   - Decap CMS GitHub OAuth プロキシ (既存機能)
//   - F案: パスワード認証 + edit_ui.html 配信 + GitHub 直接保存
// ============================================================
//
// 必要な Secret (Cloudflare ダッシュボードで設定):
//   CLIENT_ID         GitHub OAuth App Client ID (既存)
//   CLIENT_SECRET     GitHub OAuth App Client Secret (既存)
//   GITHUB_PAT        GitHub Personal Access Token (repo スコープ) ★F案 新規
//   SHARED_PASSWORD   編集用共有パスワード                       ★F案 新規
//   SESSION_SECRET    HMAC 署名鍵 (openssl rand -hex 32)         ★F案 新規
//
// 固定設定 (必要なら env に逃がしてもOK):
const REPO_OWNER = "shotaso1124";
const REPO_NAME  = "haruki_the_dance";
const REPO_BRANCH = "main";
const TARGET_PATH = "index.html";
const RAW_BASE   = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}`;
const SESSION_TTL_SEC = 8 * 60 * 60; // 8 時間
const COOKIE_NAME = "cms_session";
const SCOPE = "repo,user";

// ============================================================
// エントリポイント
// ============================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ----- 既存: Decap CMS OAuth プロキシ -----
      if (path === "/auth")     return handleOAuthAuth(env);
      if (path === "/callback") return handleOAuthCallback(request, env);

      // ----- F案: パスワード認証 + 編集UI + GitHub保存 -----
      if (path === "/login")              return handleLogin(request, env);
      if (path === "/logout")             return handleLogout();
      if (path === "/edit")               return handleEditPage(request, env);
      if (path === "/edit/")              return Response.redirect(new URL("/edit", url).toString(), 302);
      if (path === "/edit/edit_ui.css")   return handleEditAsset(request, env, "edit_ui.css", "text/css; charset=utf-8");
      if (path === "/edit/edit_ui.js")    return handleEditAsset(request, env, "edit_ui.js", "application/javascript; charset=utf-8");
      if (path === "/edit/index.html")    return handleEditAsset(request, env, "index.html", "text/html; charset=utf-8");
      if (path === "/save")               return handleSave(request, env);
      if (path === "/me")                 return handleMe(request, env);

      // ----- デフォルト -----
      return new Response("AI_SNS_School CMS Worker: OK\n\nEndpoints:\n  /auth, /callback (Decap CMS OAuth)\n  /login, /edit, /save, /me, /logout (F案)\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    } catch (err) {
      return new Response("Worker error: " + (err && err.message ? err.message : String(err)), { status: 500 });
    }
  },
};

// ============================================================
// 既存: Decap CMS OAuth プロキシ
// ============================================================
function handleOAuthAuth(env) {
  const clientId = env.CLIENT_ID;
  if (!clientId) return new Response("CLIENT_ID not configured", { status: 500 });
  const redirect = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=${SCOPE}`;
  return Response.redirect(redirect, 302);
}

async function handleOAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return new Response("missing code", { status: 400 });
  if (!env.CLIENT_ID || !env.CLIENT_SECRET) {
    return new Response("OAuth env not configured", { status: 500 });
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      code
    }),
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

// ============================================================
// F案: パスワード認証
// ============================================================

// ---------- /login (GET = フォーム / POST = 検証) ----------
async function handleLogin(request, env) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const next = sanitizeNext(url.searchParams.get("next"));
    const err  = url.searchParams.get("err");
    return new Response(renderLoginPage(next, err), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!env.SHARED_PASSWORD || !env.SESSION_SECRET) {
    return new Response("SHARED_PASSWORD / SESSION_SECRET not configured", { status: 500 });
  }

  const form = await request.formData();
  const password = String(form.get("password") || "");
  const next = sanitizeNext(String(form.get("next") || "/edit"));

  // 定数時間比較
  if (!(await constantTimeEqual(password, env.SHARED_PASSWORD))) {
    const back = `/login?err=1&next=${encodeURIComponent(next)}`;
    return Response.redirect(new URL(back, request.url).toString(), 302);
  }

  const token = await issueSession(env.SESSION_SECRET);
  const cookie = buildCookie(COOKIE_NAME, token, SESSION_TTL_SEC);

  const headers = new Headers();
  headers.set("Set-Cookie", cookie);
  headers.set("Location", next || "/edit");
  return new Response(null, { status: 302, headers });
}

function handleLogout() {
  const headers = new Headers();
  headers.set("Set-Cookie", buildCookie(COOKIE_NAME, "", 0));
  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}

// ---------- /edit (HTML 配信、未認証はログイン画面へ) ----------
async function handleEditPage(request, env) {
  const ok = await verifyRequest(request, env);
  if (!ok) {
    const url = new URL(request.url);
    const next = "/edit" + (url.search || "");
    return Response.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url).toString(), 302);
  }
  return handleEditAsset(request, env, "edit_ui.html", "text/html; charset=utf-8");
}

// ---------- /edit/* 静的アセット (HTML/CSS/JS を GitHub raw からプロキシ) ----------
async function handleEditAsset(request, env, filename, contentType) {
  // edit_ui.html は認証必須、それ以外 (CSS/JS/index.html プレビュー) も同様にガード
  const ok = await verifyRequest(request, env);
  if (!ok) {
    if (filename === "edit_ui.html") {
      const next = "/edit";
      return Response.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url).toString(), 302);
    }
    return new Response("unauthorized", { status: 401 });
  }

  // GitHub raw から取得 (キャッシュ短め)
  const raw = await fetch(`${RAW_BASE}/${filename}?ts=${Date.now()}`, {
    cf: { cacheTtl: 30, cacheEverything: true }
  });
  if (!raw.ok) {
    return new Response(`raw fetch failed: ${filename} (${raw.status})`, { status: 502 });
  }
  let body = await raw.text();

  // edit_ui.html は CSS/JS の参照を Worker 配下に書き換える
  if (filename === "edit_ui.html") {
    body = body
      .replace(/href="edit_ui\.css"/g, 'href="/edit/edit_ui.css"')
      .replace(/src="edit_ui\.js"/g, 'src="/edit/edit_ui.js"');
  }
  // edit_ui.js が fetch("index.html") する箇所を Worker 配下に
  if (filename === "edit_ui.js") {
    body = body.replace(/fetch\(['"]index\.html['"]\)/g, "fetch('/edit/index.html')");
  }

  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    }
  });
}

// ---------- /me (認証状態確認) ----------
async function handleMe(request, env) {
  const ok = await verifyRequest(request, env);
  return new Response(JSON.stringify({ authenticated: !!ok }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

// ---------- /save (編集済み HTML を GitHub に commit) ----------
async function handleSave(request, env) {
  if (request.method !== "POST") {
    return jsonError(405, "method not allowed");
  }
  const ok = await verifyRequest(request, env);
  if (!ok) return jsonError(401, "unauthorized");

  if (!env.GITHUB_PAT) return jsonError(500, "GITHUB_PAT not configured");

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }
  const newHtml = payload && typeof payload.html === "string" ? payload.html : null;
  const commitMessage = (payload && typeof payload.message === "string" && payload.message.trim())
    ? payload.message.trim().slice(0, 200)
    : `chore(cms): update ${TARGET_PATH} via edit_ui (${new Date().toISOString()})`;

  if (!newHtml) return jsonError(400, "missing html");
  if (newHtml.length > 1_500_000) return jsonError(413, "html too large");
  if (!/<html[\s>]/i.test(newHtml) || !/<\/html>/i.test(newHtml)) {
    return jsonError(400, "html missing <html> tags");
  }

  // 現在の index.html の sha を取得
  const getRes = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${TARGET_PATH}?ref=${REPO_BRANCH}`, {
    method: "GET"
  }, env);

  let sha = null;
  if (getRes.status === 200) {
    const meta = await getRes.json();
    sha = meta && meta.sha ? meta.sha : null;
  } else if (getRes.status !== 404) {
    const txt = await getRes.text();
    return jsonError(502, `github get failed: ${getRes.status} ${txt.slice(0, 200)}`);
  }

  // base64 (UTF-8 対応)
  const contentB64 = utf8ToBase64(newHtml);

  const putBody = {
    message: commitMessage,
    content: contentB64,
    branch: REPO_BRANCH,
  };
  if (sha) putBody.sha = sha;

  const putRes = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${TARGET_PATH}`, {
    method: "PUT",
    body: JSON.stringify(putBody),
  }, env);

  const putJson = await putRes.json().catch(() => ({}));
  if (!putRes.ok) {
    return jsonError(putRes.status, `github put failed: ${putJson && putJson.message ? putJson.message : putRes.statusText}`);
  }

  const commitUrl = putJson && putJson.commit && putJson.commit.html_url ? putJson.commit.html_url : null;
  const commitSha = putJson && putJson.commit && putJson.commit.sha ? putJson.commit.sha : null;

  return new Response(JSON.stringify({
    ok: true,
    commit: commitSha,
    commit_url: commitUrl,
    path: TARGET_PATH,
    branch: REPO_BRANCH,
  }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

// ============================================================
// セッション (HMAC 署名 Cookie)
// ============================================================
async function issueSession(secret) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const payload = `v1.${exp}.${nonce}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

async function verifyRequest(request, env) {
  if (!env.SESSION_SECRET) return false;
  const cookie = request.headers.get("Cookie") || "";
  const token = readCookie(cookie, COOKIE_NAME);
  if (!token) return false;
  return await verifyToken(token, env.SESSION_SECRET);
}

async function verifyToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [v, expStr, nonce, sig] = parts;
  if (v !== "v1") return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp)) return false;
  if (Math.floor(Date.now() / 1000) >= exp) return false;
  const expected = await hmacHex(secret, `${v}.${expStr}.${nonce}`);
  return await constantTimeEqual(sig, expected);
}

async function hmacHex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  const bytes = new Uint8Array(sigBuf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

async function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) {
    // 長さ差異でも一定回数比較する (簡易タイミング緩和)
    const max = Math.max(a.length, b.length);
    let diff = a.length ^ b.length;
    for (let i = 0; i < max; i++) {
      diff |= (a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length));
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ============================================================
// Cookie / GitHub API ヘルパ
// ============================================================
function buildCookie(name, value, maxAgeSec) {
  const attrs = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`,
  ];
  return attrs.join("; ");
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    if (k === name) return p.slice(idx + 1).trim();
  }
  return null;
}

function ghApi(path, init, env) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.GITHUB_PAT}`);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "ai-sns-school-cms-worker");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`https://api.github.com${path}`, { ...init, headers });
}

function utf8ToBase64(str) {
  // Cloudflare Workers の btoa は Latin1 のみなので、UTF-8 → bytes → base64 に変換
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function jsonError(status, msg) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function sanitizeNext(next) {
  if (!next || typeof next !== "string") return "/edit";
  // オープンリダイレクト防止: 同一オリジン相対パスのみ許可
  if (!next.startsWith("/")) return "/edit";
  if (next.startsWith("//")) return "/edit";
  return next;
}

// ============================================================
// ログイン画面 HTML
// ============================================================
function renderLoginPage(next, err) {
  const errBlock = err
    ? '<p class="err">パスワードが違います。</p>'
    : "";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>編集ログイン — AI_SNS_School CMS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;700;900&family=Noto+Sans+JP:wght@400;700;900&family=Caveat:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --ink:#1a1a1a;
      --ink-soft:#475569;
      --deep-blue:#2B5F8D;
      --brush-blue:#6FBCD8;
      --pale-mint:#DFF3EE;
      --pale-blue:#E8F4F9;
      --yellow:#FFE000;
      --green-1:#06C755;
      --green-2:#2E7D32;
      --border:#D7E4EC;
    }
    body{
      font-family:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif;
      background:
        radial-gradient(ellipse at top right, rgba(111,188,216,0.18) 0%, transparent 55%),
        radial-gradient(ellipse at bottom left, rgba(223,243,238,0.65) 0%, transparent 60%),
        #FFFFFF;
      color:var(--ink);
      min-height:100vh; display:flex; align-items:center; justify-content:center;
      padding:24px;
      letter-spacing:0.03em;
    }
    .card{
      position:relative;
      background:#FFFFFF;
      border:1px solid var(--border);
      border-radius:18px;
      padding:36px 32px 30px;
      width:100%;
      max-width:400px;
      box-shadow:0 10px 30px rgba(43,95,141,0.10), 0 2px 6px rgba(43,95,141,0.06);
      overflow:hidden;
      isolation:isolate;
    }
    /* 水彩ブラシ装飾（タイトル上の薄いSVGストローク） */
    .brush{
      position:absolute;
      top:18px; left:18px; right:18px;
      height:46px;
      background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 80' preserveAspectRatio='none'><defs><linearGradient id='gh' x1='0%25' y1='0%25' x2='100%25' y2='0%25'><stop offset='0%25' stop-color='%236FBCD8' stop-opacity='0.55'/><stop offset='55%25' stop-color='%2386CFB6' stop-opacity='0.45'/><stop offset='100%25' stop-color='%239FD9B5' stop-opacity='0.5'/></linearGradient></defs><path d='M6,50 C70,20 150,58 220,32 C290,10 350,48 396,30 L396,56 C350,76 290,42 220,62 C150,80 70,42 6,68 Z' fill='url(%23gh)'/></svg>") no-repeat center/100% 100%;
      z-index:0;
      pointer-events:none;
      opacity:0.9;
    }
    .accent{
      font-family:'Caveat',cursive;
      font-size:18px;
      color:var(--deep-blue);
      letter-spacing:0.02em;
      margin-bottom:4px;
      position:relative;
      z-index:1;
    }
    h1{
      font-family:'Noto Serif JP',serif;
      font-size:26px;
      font-weight:900;
      color:var(--ink);
      margin-bottom:6px;
      letter-spacing:0.05em;
      position:relative;
      z-index:1;
    }
    h1 .marker{
      background:linear-gradient(transparent 62%, var(--yellow) 62%);
      padding:0 4px;
    }
    .sub{
      font-family:'Noto Sans JP',sans-serif;
      font-size:12px;
      color:var(--ink-soft);
      margin-bottom:26px;
      letter-spacing:0.06em;
      position:relative;
      z-index:1;
    }
    label{
      display:block;
      font-family:'Noto Sans JP',sans-serif;
      font-size:13px;
      font-weight:700;
      color:var(--deep-blue);
      margin-bottom:8px;
      letter-spacing:0.04em;
      position:relative;
      z-index:1;
    }
    input[type=password]{
      width:100%;
      padding:13px 14px;
      border-radius:10px;
      border:1px solid var(--border);
      background:#FFFFFF;
      color:var(--ink);
      font-size:15px;
      font-family:'Noto Sans JP',sans-serif;
      outline:none;
      transition:border-color 0.15s ease, box-shadow 0.15s ease;
      position:relative;
      z-index:1;
      min-height:46px;
    }
    input[type=password]:focus{
      border-color:var(--deep-blue);
      box-shadow:0 0 0 3px rgba(111,188,216,0.25);
    }
    button{
      width:100%;
      margin-top:18px;
      padding:15px 16px;
      border:1px solid rgba(0,0,0,0.05);
      background:linear-gradient(135deg, var(--green-1) 0%, var(--green-2) 100%);
      color:#FFFFFF;
      font-family:'Noto Sans JP',sans-serif;
      font-size:16px;
      font-weight:900;
      letter-spacing:0.06em;
      border-radius:50px;
      cursor:pointer;
      box-shadow:0 6px 18px rgba(6,199,85,0.35), inset 0 1px 0 rgba(255,255,255,0.25);
      transition:transform 0.12s ease, box-shadow 0.15s ease, filter 0.15s ease;
      position:relative;
      z-index:1;
      min-height:50px;
    }
    button:hover{
      transform:translateY(-1px);
      box-shadow:0 8px 22px rgba(6,199,85,0.45), inset 0 1px 0 rgba(255,255,255,0.3);
      filter:brightness(1.03);
    }
    button:focus-visible{
      outline:2px solid var(--deep-blue);
      outline-offset:3px;
    }
    .err{
      color:#B91C1C;
      font-family:'Noto Sans JP',sans-serif;
      font-size:13px;
      font-weight:700;
      margin-top:14px;
      background:#FEE2E2;
      border:1px solid #FCA5A5;
      padding:10px 12px;
      border-radius:8px;
      position:relative;
      z-index:1;
    }
    .foot{
      font-family:'Noto Sans JP',sans-serif;
      font-size:11px;
      color:var(--ink-soft);
      margin-top:22px;
      text-align:center;
      letter-spacing:0.05em;
      position:relative;
      z-index:1;
    }
    @media (max-width: 420px) {
      .card{ padding:30px 22px 24px; border-radius:14px; }
      h1{ font-size:22px; }
    }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/login">
    <span class="brush" aria-hidden="true"></span>
    <p class="accent">Editor Login</p>
    <h1><span class="marker">編集ログイン</span></h1>
    <p class="sub">AI_SNS_School LP CMS</p>
    <label for="pw">パスワード</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
    <input type="hidden" name="next" value="${escapeHtml(next || "/edit")}">
    <button type="submit">ログイン</button>
    ${errBlock}
    <p class="foot">セッション有効期限: 8時間 / 編集者1人運用</p>
  </form>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
