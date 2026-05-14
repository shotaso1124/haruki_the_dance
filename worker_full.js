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
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;
      background:#0F172A; color:#E2E8F0;
      min-height:100vh; display:flex; align-items:center; justify-content:center;
      padding:24px;
    }
    .card{
      background:#1E293B; border:1px solid #334155;
      border-radius:12px; padding:32px; width:100%; max-width:380px;
      box-shadow:0 10px 30px rgba(0,0,0,.3);
    }
    h1{font-size:20px; font-weight:700; margin-bottom:4px;}
    .sub{font-size:13px; color:#94A3B8; margin-bottom:24px;}
    label{display:block; font-size:13px; color:#CBD5E1; margin-bottom:6px;}
    input[type=password]{
      width:100%; padding:12px 14px; border-radius:8px;
      border:1px solid #475569; background:#0F172A; color:#F1F5F9;
      font-size:15px; outline:none;
    }
    input[type=password]:focus{border-color:#2563EB;}
    button{
      width:100%; margin-top:16px; padding:12px 14px; border:none;
      background:#2563EB; color:#fff; font-size:15px; font-weight:600;
      border-radius:8px; cursor:pointer;
    }
    button:hover{background:#1D4ED8;}
    .err{color:#FCA5A5; font-size:13px; margin-top:12px; background:#7F1D1D33; padding:8px 10px; border-radius:6px;}
    .foot{font-size:11px; color:#64748B; margin-top:20px; text-align:center;}
  </style>
</head>
<body>
  <form class="card" method="POST" action="/login">
    <h1>編集ログイン</h1>
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
