const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => HTML_ESCAPE[character]);
}

export function parseCookies(header) {
  const output = {};
  if (!header) return output;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    try {
      output[key] = decodeURIComponent(rawValue);
    } catch {
      output[key] = rawValue;
    }
  }
  return output;
}

export function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearCookie(name) {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function configuredOrigin(env) {
  try {
    const url = new URL(String(env.DISCORD_REDIRECT_URI || ''));
    if (url.protocol !== 'https:' || url.pathname !== '/api/discord/callback') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function validEmail(email) {
  return email.length > 2 && email.length < 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validInvoice(invoiceId) {
  return /^[A-Za-z0-9._-]{1,128}$/.test(invoiceId);
}

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ');

export function securityHeaders(extra = {}) {
  return {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store, max-age=0',
    ...extra
  };
}

export function htmlPage(title, body) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)} — Member Access</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:#0b0909;color:#fff;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.card{width:min(100%,520px);padding:34px;border:1px solid #ffffff1f;border-radius:22px;background:#151111}.brand{font-weight:900;letter-spacing:.05em;margin-bottom:28px}.brand b,.eyebrow{color:#ef5a43}h1{font-size:clamp(28px,6vw,42px);line-height:1.1;margin:10px 0 18px}p{color:#ffffffb3}form{display:grid;gap:14px}label{font-weight:700}input{display:block;width:100%;margin-top:6px;padding:13px;border:1px solid #ffffff29;border-radius:10px;background:#0d0d0d;color:#fff;font:inherit}button,.btn{display:inline-flex;justify-content:center;margin-top:8px;padding:13px 17px;border:0;border-radius:10px;background:#ef4d32;color:#fff;font-weight:800;text-decoration:none;cursor:pointer}.fine{font-size:12px;color:#ffffff78}.status{display:grid;place-items:center;width:50px;height:50px;border-radius:50%;background:#ef4d3233;color:#ff8d79;font-size:26px;font-weight:900}.status.ok{background:#39c27633;color:#62dc98}
</style>
</head>
<body><main class="card"><div class="brand">MEMBER <b>ACCESS</b></div>${body}</main></body>
</html>`;
}

export function resultResponse(status, title, message, ok = false, retryAfter = null) {
  const headers = securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' });
  if (retryAfter) headers['Retry-After'] = String(retryAfter);

  const body = `<div class="status ${ok ? 'ok' : ''}">${ok ? '✓' : '!'}</div>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="btn" href="/conectar-discord/">Voltar</a>`;

  return new Response(htmlPage(title, body), { status, headers });
}

export function handleWebhookResponse(status, data) {
  const value = data && typeof data === 'object' ? String(data.status || '') : '';

  if (status === 200 && (value === 'linked' || value === 'already_linked')) {
    return { status: 200, title: 'Discord conectado com sucesso', body: 'Sua conta foi vinculada e o acesso foi liberado.', ok: true };
  }
  if (status === 403 && value === 'invalid_entitlement') {
    return { status: 403, title: 'Não conseguimos validar seu acesso', body: 'Confira o e-mail e o identificador de compra informado.', ok: false };
  }
  if (status === 409 && value === 'discord_already_linked') {
    return { status: 409, title: 'Acesso já vinculado', body: 'Este acesso já está vinculado a outra conta Discord. Fale com o suporte.', ok: false };
  }

  return { status: 503, title: 'Não foi possível concluir agora', body: 'O serviço está temporariamente indisponível. Tente novamente mais tarde.', ok: false, retryAfter: 60 };
}

export async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchWithTimeout(fetcher, input, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
