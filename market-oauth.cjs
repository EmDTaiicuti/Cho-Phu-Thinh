'use strict';

const { createHash, createHmac, randomBytes } = require('node:crypto');

function createOAuth({ db, origin, fail, hash, now, issueSession, accountDetails, cookieValue }) {
  const facebookVersion = process.env.FACEBOOK_GRAPH_VERSION || 'v27.0';
  const configs = {
    google: {
      id: process.env.GOOGLE_CLIENT_ID,
      secret: process.env.GOOGLE_CLIENT_SECRET,
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      scope: 'openid',
    },
    facebook: {
      id: process.env.FACEBOOK_APP_ID,
      secret: process.env.FACEBOOK_APP_SECRET,
      authorize: 'https://www.facebook.com/' + facebookVersion + '/dialog/oauth',
      token: 'https://graph.facebook.com/' + facebookVersion + '/oauth/access_token',
      scope: 'public_profile',
    },
  };
  const secure = origin?.protocol === 'https:';
  const loopback = origin?.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  const available = (provider) => Boolean(configs[provider].id && configs[provider].secret
    && (secure || (provider === 'google' && loopback))
    && (provider !== 'facebook' || /^v\d+\.\d+$/.test(facebookVersion)));
  const providers = Object.keys(configs).filter(available);
  const redirectUri = (provider) => new URL('/api/oauth/' + provider + '/callback', origin).href;
  const token = () => randomBytes(32).toString('hex');
  function setCookie(res, key, value, age) {
    const entry = `${key}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
    res.appendHeader('Set-Cookie', entry);
  }
  function redirect(res, target) {
    res.writeHead(303, { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end();
  }
  function destination(value) {
    return typeof value === 'string' && /^\/(?:[a-z-]+\.html)?(?:\?[^\r\n#]*)?$/.test(value) && value.length < 1500
      ? value : '/';
  }
  function finishUrl(path, status) {
    const url = new URL(path, origin);
    url.hash = 'market-auth-' + status;
    return url.pathname + url.search + url.hash;
  }
  function pending(req) {
    const key = cookieValue(req, 'market_oauth_profile');
    return key && db.prepare('SELECT provider, subject, destination FROM oauth_profiles WHERE token=? AND expiry>?').get(hash(key), now());
  }
  function complete(req, res, input) {
    const profile = pending(req);
    if (!profile) fail(401, 'Phiên đăng ký đã hết hạn. Hãy đăng nhập lại bằng Google hoặc Facebook.');
    const { name, email, phone } = accountDetails(input);
    const owner = randomBytes(16).toString('hex');
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO accounts (id,name,email,phone) VALUES (?,?,?,?)').run(owner, name, email, phone);
      const linked = db.prepare('INSERT OR IGNORE INTO oauth_accounts VALUES (?,?,?)').run(profile.provider, profile.subject, owner);
      if (!linked.changes) fail(409, 'Tài khoản này đã được tạo. Hãy đăng nhập lại.');
      db.prepare('DELETE FROM oauth_profiles WHERE token=?').run(hash(cookieValue(req, 'market_oauth_profile')));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    setCookie(res, 'market_oauth_profile', '', 0);
    issueSession(res, owner);
    return profile.destination;
  }
  async function request(url, options) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error('OAuth provider rejected request');
    return response.json();
  }
  async function subject(provider, code, verifier) {
    const config = configs[provider];
    const params = new URLSearchParams({
      client_id: config.id, client_secret: config.secret, redirect_uri: redirectUri(provider), code,
    });
    if (provider === 'google') {
      params.set('grant_type', 'authorization_code');
      params.set('code_verifier', verifier);
      const grant = await request(config.token, { method: 'POST', body: params });
      if (typeof grant.access_token !== 'string' || !grant.access_token) throw new Error('Missing token');
      const profile = await request('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: 'Bearer ' + grant.access_token },
      });
      return profile.sub;
    }
    const grant = await request(config.token + '?' + params);
    if (typeof grant.access_token !== 'string' || !grant.access_token) throw new Error('Missing token');
    const proof = createHmac('sha256', config.secret).update(grant.access_token).digest('hex');
    const graph = 'https://graph.facebook.com/' + facebookVersion + '/me?fields=id&appsecret_proof=' + proof;
    const profile = await request(graph, { headers: { Authorization: 'Bearer ' + grant.access_token } });
    return profile.id;
  }
  async function route(req, res, provider, action, query) {
    if (!available(provider)) fail(503, 'Cách đăng nhập này chưa được bật.');
    if (action === 'start') {
      const state = token();
      const browser = token();
      const verifier = provider === 'google' ? token() : '';
      db.prepare('DELETE FROM oauth_attempts WHERE expiry<=?').run(now());
      db.prepare('DELETE FROM oauth_profiles WHERE expiry<=?').run(now());
      db.prepare('INSERT INTO oauth_attempts VALUES (?,?,?,?,?,?)')
        .run(hash(state), hash(browser), provider, verifier, destination(query.get('return')), now() + 600_000);
      setCookie(res, 'market_oauth_browser', browser, 600);
      const authorization = new URL(configs[provider].authorize);
      authorization.search = new URLSearchParams({
        client_id: configs[provider].id, redirect_uri: redirectUri(provider),
        response_type: 'code', scope: configs[provider].scope, state,
      });
      if (verifier) {
        authorization.searchParams.set('code_challenge_method', 'S256');
        authorization.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
      }
      return redirect(res, authorization.href);
    }
    const state = query.get('state');
    const browser = cookieValue(req, 'market_oauth_browser');
    const attempt = state && browser && db.prepare(
      'DELETE FROM oauth_attempts WHERE state=? AND browser=? AND provider=? AND expiry>? RETURNING verifier,destination'
    ).get(hash(state), hash(browser), provider, now());
    if (!attempt) return redirect(res, finishUrl('/', 'expired'));
    setCookie(res, 'market_oauth_browser', '', 0);
    const code = query.get('code');
    if (!code || query.has('error')) return redirect(res, finishUrl(attempt.destination, 'cancelled'));
    let providerSubject;
    try {
      providerSubject = await subject(provider, code, attempt.verifier);
      if (typeof providerSubject !== 'string' || !providerSubject || providerSubject.length > 255) throw new Error('Missing subject');
    } catch {
      return redirect(res, finishUrl(attempt.destination, 'failed'));
    }
    const existing = db.prepare('SELECT owner FROM oauth_accounts WHERE provider=? AND subject=?').get(provider, providerSubject);
    if (existing) {
      setCookie(res, 'market_oauth_profile', '', 0);
      issueSession(res, existing.owner);
      return redirect(res, attempt.destination);
    }
    const signup = token();
    db.prepare('INSERT INTO oauth_profiles VALUES (?,?,?,?,?)').run(hash(signup), provider, providerSubject, attempt.destination, now() + 600_000);
    setCookie(res, 'market_oauth_profile', signup, 600);
    return redirect(res, finishUrl(attempt.destination, 'complete'));
  }
  return { providers, route, complete, pending };
}

module.exports = { createOAuth };
