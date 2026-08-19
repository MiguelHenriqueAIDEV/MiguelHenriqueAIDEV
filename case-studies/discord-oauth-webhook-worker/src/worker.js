import { decryptSession, encryptSession, generateToken, timingSafeEqual } from './crypto.js';
import {
  clearCookie,
  configuredOrigin,
  cookie,
  fetchWithTimeout,
  handleWebhookResponse,
  htmlPage,
  parseCookies,
  readJsonSafe,
  resultResponse,
  securityHeaders,
  validEmail,
  validInvoice
} from './http.js';

const CSRF_COOKIE = '__Host-member-link-csrf';
const SESSION_COOKIE = '__Host-member-link-session';
const CSRF_MAX_AGE = 600;
const SESSION_MAX_AGE = 600;

function sameSiteRequest(request, url, csrfToken, formToken) {
  if (!csrfToken || !formToken || !timingSafeEqual(csrfToken, formToken)) return false;
  if (String(request.headers.get('Sec-Fetch-Site') || '').toLowerCase() === 'cross-site') return false;

  const origin = request.headers.get('Origin');
  if (!origin || origin === 'null') return true;

  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

async function accessPage() {
  const csrfToken = generateToken();
  const body = `<div class="eyebrow">MEMBER ACCESS</div>
<h1>Conecte seu Discord</h1>
<p>Use os dados de compra ou entitlement para validar seu acesso.</p>
<form method="POST" action="/api/discord/link">
  <input type="hidden" name="csrf_token" value="${csrfToken}">
  <label>E-mail usado na compra<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
  <label>Invoice / entitlement ID<input name="invoice_id" type="text" maxlength="128" required></label>
  <button type="submit">Conectar meu Discord</button>
</form>
<p class="fine">Os dados informados são usados apenas para validar o acesso. A aplicação nunca solicita a senha ou token do Discord.</p>`;

  return new Response(htmlPage('Conectar Discord', body), {
    status: 200,
    headers: securityHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': cookie(CSRF_COOKIE, csrfToken, CSRF_MAX_AGE)
    })
  });
}

async function startLink(request, env, url) {
  if (Number(request.headers.get('Content-Length') || 0) > 4096) {
    return resultResponse(400, 'Dados inválidos', 'Confira os dados informados.');
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return resultResponse(400, 'Dados inválidos', 'Confira os dados informados.');
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const csrfToken = cookies[CSRF_COOKIE] || '';
  const formToken = String(form.get('csrf_token') || '');
  const email = String(form.get('email') || '').trim().toLowerCase();
  const invoiceId = String(form.get('invoice_id') || '').trim();

  if (!sameSiteRequest(request, url, csrfToken, formToken)) {
    return resultResponse(403, 'Solicitação não aceita', 'Abra esta página pelo site oficial.');
  }
  if (!validEmail(email) || !validInvoice(invoiceId)) {
    return resultResponse(400, 'Dados inválidos', 'Confira o e-mail e o identificador de compra informado.');
  }

  const session = await encryptSession(
    { email, invoice_id: invoiceId, created_at: Date.now() },
    env.DISCORD_LINK_SESSION_SECRET
  );

  const response = new Response(null, {
    status: 303,
    headers: securityHeaders({
      Location: '/api/discord/login',
      'Set-Cookie': cookie(SESSION_COOKIE, session, SESSION_MAX_AGE)
    })
  });
  response.headers.append('Set-Cookie', clearCookie(CSRF_COOKIE));
  return response;
}

async function startOAuth(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const session = await decryptSession(cookies[SESSION_COOKIE] || '', env.DISCORD_LINK_SESSION_SECRET);

  if (!session || !validEmail(String(session.email || '')) || !validInvoice(String(session.invoice_id || '')) ||
      !Number.isFinite(session.created_at) || Date.now() - session.created_at > SESSION_MAX_AGE * 1000) {
    return resultResponse(400, 'Sessão expirada', 'Inicie novamente a conexão.');
  }

  const state = generateToken();
  const nextSession = await encryptSession(
    { ...session, state, oauth_started_at: Date.now() },
    env.DISCORD_LINK_SESSION_SECRET
  );

  const params = new URLSearchParams({
    client_id: String(env.DISCORD_CLIENT_ID),
    redirect_uri: String(env.DISCORD_REDIRECT_URI),
    response_type: 'code',
    scope: 'identify',
    state
  });

  return new Response(null, {
    status: 302,
    headers: securityHeaders({
      Location: `https://discord.com/oauth2/authorize?${params.toString()}`,
      'Set-Cookie': cookie(SESSION_COOKIE, nextSession, SESSION_MAX_AGE)
    })
  });
}

async function oauthCallback(request, env, url, fetcher) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || code.length > 512 || state.length > 256) {
    return resultResponse(400, 'Não foi possível concluir a conexão', 'A sessão de autorização é inválida ou expirou.');
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const session = await decryptSession(cookies[SESSION_COOKIE] || '', env.DISCORD_LINK_SESSION_SECRET);
  if (!session || !validEmail(String(session.email || '')) || !validInvoice(String(session.invoice_id || '')) ||
      !timingSafeEqual(String(session.state || ''), state) || !Number.isFinite(session.oauth_started_at) ||
      Date.now() - session.oauth_started_at > SESSION_MAX_AGE * 1000) {
    return resultResponse(400, 'Não foi possível concluir a conexão', 'A sessão de autorização expirou.');
  }

  try {
    const tokenResponse = await fetchWithTimeout(fetcher, 'https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: String(env.DISCORD_CLIENT_ID),
        client_secret: String(env.DISCORD_CLIENT_SECRET),
        grant_type: 'authorization_code',
        code,
        redirect_uri: String(env.DISCORD_REDIRECT_URI)
      })
    }, 8000);

    const token = await readJsonSafe(tokenResponse);
    if (!tokenResponse.ok || !token?.access_token || String(token.token_type || '').toLowerCase() !== 'bearer') {
      return resultResponse(503, 'Não foi possível concluir agora', 'O serviço está temporariamente indisponível.', false, 60);
    }

    const userResponse = await fetchWithTimeout(fetcher, 'https://discord.com/api/v10/users/@me', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token.access_token}` }
    }, 8000);
    const user = await readJsonSafe(userResponse);

    if (!userResponse.ok || !/^\d{15,22}$/.test(String(user?.id || '')) || typeof user?.username !== 'string' || !user.username) {
      return resultResponse(503, 'Não foi possível concluir agora', 'O serviço está temporariamente indisponível.', false, 60);
    }

    let webhookStatus = 0;
    let webhookJson = null;
    try {
      const webhookResponse = await fetchWithTimeout(fetcher, String(env.VALIDATION_WEBHOOK_URL), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': String(env.VALIDATION_WEBHOOK_API_KEY) },
        body: JSON.stringify({
          email: String(session.email),
          invoice_id: String(session.invoice_id),
          discord_user_id: String(user.id),
          discord_username: String(user.username)
        })
      }, 10000);
      webhookStatus = webhookResponse.status;
      webhookJson = await readJsonSafe(webhookResponse);
    } catch {
      webhookStatus = 0;
    }

    const result = handleWebhookResponse(webhookStatus, webhookJson);
    const response = resultResponse(result.status, result.title, result.body, result.ok, result.retryAfter || null);
    response.headers.append('Set-Cookie', clearCookie(SESSION_COOKIE));
    return response;
  } catch {
    return resultResponse(503, 'Não foi possível concluir agora', 'O serviço está temporariamente indisponível.', false, 60);
  }
}

export function createDiscordWorker(fetcher = fetch) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const canonicalOrigin = configuredOrigin(env);
      if (!canonicalOrigin) return resultResponse(503, 'Serviço indisponível', 'Configuração inválida.', false, 60);

      if (['/conectar-discord', '/conectar-discord/'].includes(url.pathname) && method === 'GET' && url.origin !== canonicalOrigin) {
        return new Response(null, { status: 308, headers: securityHeaders({ Location: `${canonicalOrigin}/conectar-discord/` }) });
      }
      if (url.pathname === '/conectar-discord' && method === 'GET') {
        return new Response(null, { status: 308, headers: securityHeaders({ Location: `${canonicalOrigin}/conectar-discord/` }) });
      }
      if (url.pathname === '/conectar-discord/' && method === 'GET') return accessPage();

      if (url.origin !== canonicalOrigin && url.pathname.startsWith('/api/')) {
        return new Response(null, { status: 303, headers: securityHeaders({ Location: `${canonicalOrigin}/conectar-discord/` }) });
      }

      if (url.pathname === '/api/discord/link' && method === 'POST') return startLink(request, env, url);
      if (url.pathname === '/api/discord/login' && method === 'GET') return startOAuth(request, env);
      if (url.pathname === '/api/discord/callback' && method === 'GET') return oauthCallback(request, env, url, fetcher);

      if (url.pathname.startsWith('/api/')) {
        return new Response('Not Found', { status: 404, headers: securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }) });
      }
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
      return new Response('Not Found', { status: 404, headers: securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }) });
    }
  };
}

export default createDiscordWorker();
