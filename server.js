const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = process.env.FITORA_DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 80);
const BASE_URL = process.env.FITORA_BASE_URL || 'https://fitora.fitsystem.com.ar';
const COOKIE = 'fitora_session';
const MAX_BODY = 10 * 1024 * 1024;
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(DATA_DIR, 'fitora.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preapproval_id TEXT UNIQUE, status TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS backups (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_payload TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`);
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'google_sub')) {
  db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique ON users(google_sub) WHERE google_sub IS NOT NULL');
try { fs.chmodSync(path.join(DATA_DIR, 'fitora.sqlite'), 0o600); } catch {}

function loadEncryptionKey() {
  const keyPath = path.join(DATA_DIR, '.encryption-key');
  try {
    const key = fs.readFileSync(keyPath);
    if (key.length === 32) return key;
    throw new Error('Invalid encryption key file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const key = crypto.randomBytes(32);
    const fd = fs.openSync(keyPath, 'wx', 0o600);
    fs.writeFileSync(fd, key);
    fs.closeSync(fd);
    return key;
  }
}
const DATA_KEY = loadEncryptionKey();

function json(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}
function cookieValue(req, name) {
  const part = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}
function hashToken(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function setSessionCookie(res, token, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
function safeUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, premium: row.subscription_status === 'authorized', subscriptionStatus: row.subscription_status || 'none' };
}
function findUser(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.email, s.status AS subscription_status
    FROM sessions a JOIN users u ON u.id = a.user_id
    LEFT JOIN subscriptions s ON s.user_id = u.id
    WHERE a.token_hash = ? AND a.expires_at > ?`).get(hashToken(token), Date.now());
  return safeUser(row);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  try { return new URL(origin).origin === `${proto}://${host}`; } catch { return false; }
}
async function bodyJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
function premiumConfig() {
  const price = Number(process.env.FITORA_PREMIUM_PRICE_ARS || '10000');
  const publicKey = String(process.env.MP_PUBLIC_KEY || '').trim();
  const enabled = Boolean(publicKey && process.env.MP_ACCESS_TOKEN && process.env.MP_WEBHOOK_SECRET && Number.isFinite(price) && price > 0);
  return { checkoutEnabled: enabled, publicKey: enabled ? publicKey : '', amount: enabled ? price : 0, currency: 'ARS', frequency: 'mensual', googleClientId: String(process.env.GOOGLE_CLIENT_ID || '').trim() };
}
let googleKeys = null;
let googleKeysExpiresAt = 0;
async function verifyGoogleCredential(token, expectedNonce) {
  if (!process.env.GOOGLE_CLIENT_ID) throw Object.assign(new Error('El acceso con Google todavía no está configurado.'), { status: 503 });
  if (typeof token !== 'string' || token.length > 10000) throw Object.assign(new Error('Credencial de Google inválida.'), { status: 401 });
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Credencial de Google inválida.'), { status: 401 });
  let header, claims, signature;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    signature = Buffer.from(parts[2], 'base64url');
  } catch { throw Object.assign(new Error('Credencial de Google inválida.'), { status: 401 }); }
  if (header.alg !== 'RS256' || !header.kid || !signature.length) throw Object.assign(new Error('Credencial de Google inválida.'), { status: 401 });
  if (!googleKeys || Date.now() >= googleKeysExpiresAt) {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Object.assign(new Error('No se pudo validar la cuenta de Google.'), { status: 502 });
    const data = await response.json();
    googleKeys = data.keys || [];
    const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 300);
    googleKeysExpiresAt = Date.now() + Math.min(maxAge, 86400) * 1000;
  }
  const jwk = googleKeys.find(key => key.kid === header.kid && key.alg === 'RS256');
  if (!jwk) throw Object.assign(new Error('Credencial de Google vencida; volvé a intentarlo.'), { status: 401 });
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  let validSignature = false;
  try { validSignature = crypto.verify('RSA-SHA256', signingInput, crypto.createPublicKey({ key: jwk, format: 'jwk' }), signature); } catch {}
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud.includes(process.env.GOOGLE_CLIENT_ID) : claims.aud === process.env.GOOGLE_CLIENT_ID;
  if (!validSignature || !aud || (claims.azp && claims.azp !== process.env.GOOGLE_CLIENT_ID) || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || !claims.exp || claims.exp <= now || (claims.iat && claims.iat > now + 60) || claims.nonce !== expectedNonce || claims.email_verified !== true || typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
    throw Object.assign(new Error('No se pudo verificar tu cuenta de Google.'), { status: 401 });
  }
  return { sub: claims.sub, email: claims.email.trim().toLowerCase() };
}
function encryptBackup(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(x => x.toString('base64url')).join('.');
}
function decryptBackup(value) {
  const [iv, tag, encrypted] = value.split('.').map(x => Buffer.from(x, 'base64url'));
  if (!iv || !tag || !encrypted) throw new Error('Invalid encrypted backup');
  const decipher = crypto.createDecipheriv('aes-256-gcm', DATA_KEY, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
}
function statusIsPremium(status) { return status === 'authorized'; }
function signIn(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = 30 * 24 * 60 * 60;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, Date.now() + maxAge * 1000);
  setSessionCookie(res, token, maxAge);
}
function readPassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) return null;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function validPassword(password, salt, stored) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(stored, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
async function mercadoPago(pathname, options = {}) {
  const response = await fetch(`https://api.mercadopago.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Mercado Pago request failed', response.status, data.error || data.message || 'unknown');
    throw Object.assign(new Error('Mercado Pago no pudo procesar la operación'), { status: 502 });
  }
  return data;
}
function validWebhook(req, url) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  const signature = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const dataId = String(url.searchParams.get('data.id') || url.searchParams.get('id') || '').toLowerCase();
  const parts = signature.split(',').map(x => x.trim());
  const ts = parts.find(x => x.startsWith('ts='))?.slice(3);
  const v1 = parts.find(x => x.startsWith('v1='))?.slice(3);
  if (!secret || !dataId || !ts || !v1 || !requestId) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest();
  let received;
  try { received = Buffer.from(v1, 'hex'); } catch { return false; }
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
async function handleWebhook(req, res, url) {
  if (!validWebhook(req, url)) return json(res, 401, { error: 'Firma inválida' });
  const notice = await bodyJson(req).catch(() => ({}));
  const type = String(notice.type || url.searchParams.get('type') || url.searchParams.get('topic') || '');
  if (!['subscription_preapproval', 'preapproval'].includes(type)) return json(res, 200, { received: true });
  const id = String(notice.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id') || '');
  if (!id) return json(res, 200, { received: true });
  try {
    const subscription = await mercadoPago(`/preapproval/${encodeURIComponent(id)}`);
    const userId = String(subscription.external_reference || '');
    if (!userId) return json(res, 200, { received: true });
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!existing) return json(res, 200, { received: true });
    db.prepare(`INSERT INTO subscriptions (user_id,preapproval_id,status,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET preapproval_id=excluded.preapproval_id,status=excluded.status,updated_at=excluded.updated_at`)
      .run(userId, String(subscription.id), String(subscription.status || 'pending'), new Date().toISOString());
    if (!statusIsPremium(subscription.status)) db.prepare('DELETE FROM backups WHERE user_id = ?').run(userId);
    return json(res, 200, { received: true });
  } catch (error) {
    console.error('Mercado Pago webhook sync failed', error.status || 'error');
    return json(res, 503, { error: 'No se pudo actualizar la suscripción' });
  }
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (url.pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true });
    if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, premiumConfig());
    if (url.pathname === '/api/webhooks/mercadopago' && req.method === 'POST') return await handleWebhook(req, res, url);

    if (url.pathname.startsWith('/api/') && !sameOrigin(req)) return json(res, 403, { error: 'Origen no permitido' });
    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      const data = await bodyJson(req);
      const email = String(data.email || '').trim().toLowerCase();
      const password = readPassword(data.password);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password) return json(res, 400, { error: 'Ingresá un email válido y una contraseña de al menos 10 caracteres.' });
      const id = crypto.randomUUID();
      try { db.prepare('INSERT INTO users (id,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?)').run(id,email,password.salt,password.hash,new Date().toISOString()); }
      catch { return json(res, 409, { error: 'Ya existe una cuenta con ese email.' }); }
      signIn(res, id);
      return json(res, 201, { user: { id, email, premium: false, subscriptionStatus: 'none' } });
    }
    if (url.pathname === '/api/auth/google/nonce' && req.method === 'GET') {
      if (!process.env.GOOGLE_CLIENT_ID) return json(res, 503, { error: 'El acceso con Google todavía no está configurado.' });
      const nonce = crypto.randomBytes(32).toString('base64url');
      res.setHeader('Set-Cookie', `fitora_google_nonce=${encodeURIComponent(nonce)}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=300`);
      return json(res, 200, { nonce });
    }
    if (url.pathname === '/api/auth/google' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'fitora_google_nonce=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      const data = await bodyJson(req);
      const identity = await verifyGoogleCredential(data.credential, cookieValue(req, 'fitora_google_nonce'));
      let account = db.prepare('SELECT id,email,google_sub FROM users WHERE google_sub = ?').get(identity.sub);
      if (!account) {
        account = db.prepare('SELECT id,email,google_sub FROM users WHERE email = ?').get(identity.email);
        if (account?.google_sub && account.google_sub !== identity.sub) return json(res, 409, { error: 'Esta cuenta de Fitora ya está vinculada a otro Google.' });
        if (account) {
          db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(identity.sub, account.id);
        } else {
          const id = crypto.randomUUID();
          const inaccessiblePassword = crypto.randomBytes(64).toString('hex');
          const salt = crypto.randomBytes(16).toString('hex');
          const passwordHash = crypto.scryptSync(inaccessiblePassword, salt, 64).toString('hex');
          try {
            db.prepare('INSERT INTO users (id,email,password_salt,password_hash,created_at,google_sub) VALUES (?,?,?,?,?,?)')
              .run(id, identity.email, salt, passwordHash, new Date().toISOString(), identity.sub);
          } catch {
            return json(res, 409, { error: 'No se pudo crear la cuenta con Google. Probá iniciar sesión nuevamente.' });
          }
          account = { id, email: identity.email, google_sub: identity.sub };
        }
      }
      signIn(res, account.id);
      const current = findUser(cookieValue(req, COOKIE));
      return json(res, 200, { user: current || { id: account.id, email: account.email, premium: false, subscriptionStatus: 'none' } });
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const data = await bodyJson(req);
      const email = String(data.email || '').trim().toLowerCase();
      const user = db.prepare('SELECT id,email,password_salt,password_hash FROM users WHERE email = ?').get(email);
      if (!user || !validPassword(data.password, user.password_salt, user.password_hash)) return json(res, 401, { error: 'Email o contraseña incorrectos.' });
      signIn(res, user.id);
      return json(res, 200, { user: findUser(cookieValue(req, COOKIE)) || { id: user.id, email: user.email, premium: false, subscriptionStatus: 'none' } });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = cookieValue(req, COOKIE);
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }
    const user = findUser(cookieValue(req, COOKIE));
    if (url.pathname === '/api/auth/me' && req.method === 'GET') return json(res, 200, { user });

    if (url.pathname === '/api/subscription' && req.method === 'POST') {
      if (!user) return json(res, 401, { error: 'Iniciá sesión para contratar Fitora Premium.' });
      const config = premiumConfig();
      if (!config.checkoutEnabled) return json(res, 503, { error: 'El checkout todavía no está configurado.' });
      if (user.premium) return json(res, 200, { status: 'authorized' });
      const data = await bodyJson(req);
      const cardToken = String(data.token || '');
      if (!cardToken || cardToken.length > 300 || data.cloudConsent !== true) return json(res, 400, { error: 'Confirmá el respaldo en la VPS y completá el pago embebido.' });
      const payerEmail = String(data.payerEmail || user.email).trim().toLowerCase();
      if (payerEmail !== user.email) return json(res, 400, { error: 'El email del pagador debe coincidir con el de tu cuenta Fitora.' });
      const existing = db.prepare('SELECT status FROM subscriptions WHERE user_id = ?').get(user.id);
      if (existing && ['authorized','pending','creating'].includes(existing.status)) return json(res, 409, { error: 'Ya hay una suscripción activa o en proceso para esta cuenta.' });
      db.prepare(`INSERT INTO subscriptions (user_id,preapproval_id,status,updated_at) VALUES (?,NULL,'creating',?)
        ON CONFLICT(user_id) DO UPDATE SET preapproval_id=NULL,status='creating',updated_at=excluded.updated_at`)
        .run(user.id, new Date().toISOString());
      let subscription;
      try {
        subscription = await mercadoPago('/preapproval', {
          method: 'POST',
          headers: { 'X-Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            reason: 'Fitora Premium - sincronización privada',
            external_reference: user.id,
            payer_email: payerEmail,
            card_token_id: cardToken,
            auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: config.amount, currency_id: 'ARS' },
            back_url: `${BASE_URL}/?premium=return`,
            notification_url: `${BASE_URL}/api/webhooks/mercadopago`,
            status: 'authorized',
          }),
        });
      } catch (error) {
        db.prepare("UPDATE subscriptions SET status='failed',updated_at=? WHERE user_id=? AND status='creating'")
          .run(new Date().toISOString(), user.id);
        throw error;
      }
      db.prepare(`UPDATE subscriptions SET preapproval_id=?,status=?,updated_at=? WHERE user_id=? AND status='creating'`)
        .run(String(subscription.id || ''), String(subscription.status || 'pending'), new Date().toISOString(), user.id);
      const finalStatus = db.prepare('SELECT status FROM subscriptions WHERE user_id=?').get(user.id)?.status || subscription.status || 'pending';
      return json(res, 200, { status: String(finalStatus), premium: statusIsPremium(finalStatus) });
    }
    if (url.pathname === '/api/subscription/cancel' && req.method === 'POST') {
      if (!user) return json(res, 401, { error: 'Iniciá sesión.' });
      const subscription = db.prepare('SELECT preapproval_id FROM subscriptions WHERE user_id = ?').get(user.id);
      if (!subscription?.preapproval_id) return json(res, 404, { error: 'No encontramos una suscripción.' });
      await mercadoPago(`/preapproval/${encodeURIComponent(subscription.preapproval_id)}`, { method: 'PUT', body: JSON.stringify({ status: 'canceled' }) });
      db.prepare('UPDATE subscriptions SET status = ?, updated_at = ? WHERE user_id = ?').run('canceled', new Date().toISOString(), user.id);
      db.prepare('DELETE FROM backups WHERE user_id = ?').run(user.id);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/backup' && (req.method === 'GET' || req.method === 'PUT' || req.method === 'DELETE')) {
      if (!user) return json(res, 401, { error: 'Iniciá sesión para usar Fitora Premium.' });
      if (!user.premium) return json(res, 403, { error: 'El respaldo en la VPS está disponible solo con Premium activo.' });
      if (req.method === 'GET') {
        const row = db.prepare('SELECT encrypted_payload,updated_at FROM backups WHERE user_id = ?').get(user.id);
        if (!row) return json(res, 200, { backup: null });
        return json(res, 200, { backup: decryptBackup(row.encrypted_payload), updatedAt: row.updated_at });
      }
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM backups WHERE user_id = ?').run(user.id);
        return json(res, 200, { ok: true });
      }
      const backup = await bodyJson(req);
      if (backup.app !== 'Fitora' || !Array.isArray(backup.sessions) || !Array.isArray(backup.favorites) || !Array.isArray(backup.routines)) return json(res, 400, { error: 'La copia de Fitora no tiene un formato válido.' });
      const encrypted = encryptBackup(backup);
      const updatedAt = new Date().toISOString();
      db.prepare(`INSERT INTO backups (user_id,encrypted_payload,updated_at) VALUES (?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload,updated_at=excluded.updated_at`)
        .run(user.id, encrypted, updatedAt);
      return json(res, 200, { ok: true, updatedAt });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Ruta no encontrada.' });

    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método no permitido.' });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Ruta inválida.' }); }
    const file = path.resolve(ROOT, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${ROOT}${path.sep}`)) return json(res, 403, { error: 'Ruta no permitida.' });
    let stat;
    try { stat = fs.statSync(file); } catch { return json(res, 404, { error: 'No encontrado.' }); }
    if (!stat.isFile()) return json(res, 404, { error: 'No encontrado.' });
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': path.basename(file) === 'sw.js' || path.basename(file) === 'index.html' ? 'no-cache' : 'public, max-age=300',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    console.error('Request failed', error.status || 'internal');
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'No se pudo completar la solicitud.' });
    else res.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Fitora server listening on ${PORT}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => { db.close(); process.exit(0); }); });
