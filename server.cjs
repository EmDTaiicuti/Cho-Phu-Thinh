'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { marketZones } = require('./Scripts/market-data.js');
const { marketRegions } = require('./Scripts/market-regions.js');
const { createOAuth } = require('./market-oauth.cjs');

const derive = promisify(scrypt);
const dataDir = path.resolve(process.env.MARKET_DATA_DIR || path.join(__dirname, '.market-data'));
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'market.sqlite'));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, handle TEXT UNIQUE, name TEXT, salt TEXT, password BLOB);
  CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, owner TEXT REFERENCES accounts(id), expiry INTEGER);
  CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, owner TEXT REFERENCES accounts(id), payload TEXT, photo BLOB, mime TEXT, created INTEGER, deleted INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS listing_photos (listing TEXT REFERENCES listings(id), position INTEGER, photo BLOB NOT NULL, mime TEXT NOT NULL, PRIMARY KEY(listing,position));
  CREATE TABLE IF NOT EXISTS saved (owner TEXT REFERENCES accounts(id), listing TEXT REFERENCES listings(id), PRIMARY KEY(owner,listing));
  CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, listing TEXT REFERENCES listings(id), buyer TEXT REFERENCES accounts(id), UNIQUE(listing,buyer));
  CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, thread TEXT REFERENCES threads(id), sender TEXT REFERENCES accounts(id), body TEXT, created INTEGER);
  CREATE TABLE IF NOT EXISTS oauth_accounts (provider TEXT, subject TEXT, owner TEXT REFERENCES accounts(id), PRIMARY KEY(provider,subject));
  CREATE TABLE IF NOT EXISTS oauth_attempts (state TEXT PRIMARY KEY, browser TEXT, provider TEXT, verifier TEXT, destination TEXT, expiry INTEGER);
  CREATE TABLE IF NOT EXISTS oauth_profiles (token TEXT PRIMARY KEY, provider TEXT, subject TEXT, destination TEXT, expiry INTEGER);
`);
db.exec('BEGIN IMMEDIATE');
try {
  const columns = db.prepare('PRAGMA table_info(accounts)').all().map((column) => column.name);
  if (!columns.includes('email')) db.exec('ALTER TABLE accounts ADD COLUMN email TEXT');
  if (!columns.includes('phone')) db.exec('ALTER TABLE accounts ADD COLUMN phone TEXT');
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
const origin = process.env.MARKET_ORIGIN ? new URL(process.env.MARKET_ORIGIN) : null;
const cookie = 'market_session';
const secure = origin?.protocol === 'https:' ? '; Secure' : '';
const id = () => randomBytes(16).toString('hex');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const now = () => Date.now();
const attempts = new Map();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function cookieValue(req, key) {
  const header = req.headers.cookie ?? '';
  return new RegExp('(?:^|; *)' + key + '=([a-f0-9]{64})(?:;|$)').exec(header)?.[1];
}
function issueSession(res, owner) {
  const token = randomBytes(32).toString('hex');
  const expiry = now() + 7 * 86_400_000;
  db.prepare('DELETE FROM sessions WHERE expiry<=?').run(now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), owner, expiry);
  res.appendHeader('Set-Cookie', `${cookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}
function accountDetails(input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim().replace(/[().\s-]/g, '') : '';
  if (name.length < 2 || name.length > 50) fail(400, 'Tên hiển thị cần từ 2 đến 50 ký tự.');
  if (!email && !phone) fail(400, 'Nhập email hoặc số điện thoại.');
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) fail(400, 'Email chưa đúng định dạng.');
  if (phone && !/^\+?[0-9]{9,15}$/.test(phone)) fail(400, 'Số điện thoại cần từ 9 đến 15 chữ số.');
  return { name, email: email || null, phone: phone || null };
}
const oauth = createOAuth({ db, origin, fail, hash, now, issueSession, accountDetails, cookieValue });
function limitAuth(req) {
  const key = req.socket.remoteAddress;
  const time = now();
  for (const [address, count] of attempts) if (count.until <= time) attempts.delete(address);
  const count = attempts.get(key) ?? { total: 0, until: time + 60_000 };
  if (++count.total > 15) fail(429, 'Bạn thao tác hơi nhanh. Thử lại sau một phút.');
  attempts.set(key, count);
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req, maxBytes = 1_450_000) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) fail(415, 'Dữ liệu cần ở dạng JSON.');
  if (Number(req.headers['content-length']) > maxBytes) {
    req.resume();
    fail(413, 'Ảnh hoặc nội dung quá lớn.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maxBytes) {
      req.resume();
      fail(413, 'Ảnh hoặc nội dung quá lớn.');
    }
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks)); } catch { fail(400, 'Dữ liệu không hợp lệ.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Dữ liệu không hợp lệ.');
  return value;
}
function currentUser(req) {
  const token = cookieValue(req, cookie);
  return token && db.prepare('SELECT a.id,a.handle,a.name FROM sessions s JOIN accounts a ON a.id=s.owner WHERE s.hash=? AND s.expiry>?').get(hash(token), now());
}
const listingRow = (listingId) => db.prepare('SELECT * FROM listings WHERE id=? AND deleted=0').get(listingId);
function listingData(row) {
  const payload = JSON.parse(row.payload);
  const previous = marketZones.find((zone) => zone.id === payload.zone)?.previousCategories;
  if (previous && Object.hasOwn(previous, payload.category)) {
    if (payload.category === 'Ở ghép') payload.sharedRoom = true;
    payload.category = previous[payload.category];
  }
  const image = row.hasPhoto ? '/api/photos/' + row.id : '';
  const images = image ? [image, ...Array.from({ length: row.extraPhotos }, (_, index) => image + '/' + (index + 2))] : [];
  return { ...payload, id: row.id, image, images };
}
function validQuantity(quantity) {
  return Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= 9999;
}
function validateListing(input) {
  const zone = marketZones.find((item) => item.id === input.zone);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
  const region = typeof input.province === 'string' && Object.hasOwn(marketRegions, input.province)
    ? marketRegions[input.province] : [];
  const ward = region.includes(input.ward) ? input.ward : '';
  const remote = zone?.id === 'viec-lam' && input.remote === true;
  const exchange = ['do-cu', 'tai-lieu'].includes(zone?.id);
  const delivery = exchange && ['direct', 'arrange', 'both'].includes(input.delivery) ? input.delivery : '';
  const quantity = input.quantity === undefined ? 1 : input.quantity;
  if (exchange && !validQuantity(quantity)) fail(400, 'Số lượng phải là số nguyên từ 0 đến 9.999.');
  if (!zone || !zone.categories.includes(input.category) || !zone.filters.includes(input.attribute)
      || title.length < 5 || title.length > 100 || detail.length < 15 || detail.length > 2500
      || (!remote && (!ward || input.category === 'Làm từ xa')) || (exchange && !delivery)
      || !Number.isSafeInteger(input.price) || input.price < 0 || input.price > 100_000_000_000) {
    fail(400, 'Hãy kiểm tra lại thông tin tin đăng.');
  }
  const imageInputs = input.images === undefined ? (input.image ? [input.image] : []) : input.images;
  if (!Array.isArray(imageInputs) || imageInputs.length > 5) fail(400, 'Mỗi tin chỉ được tải tối đa 5 ảnh.');
  const photos = imageInputs.map((image) => {
    const match = typeof image === 'string' && /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match) fail(400, 'Chọn ảnh JPG, PNG hoặc WebP.');
    const photo = Buffer.from(match[3], 'base64');
    const sig = photo.subarray(0, 12).toString('hex');
    const valid = { jpeg: sig.startsWith('ffd8ff'), png: sig.startsWith('89504e470d0a1a0a'), webp: sig.startsWith('52494646') && sig.endsWith('57454250') };
    if (!valid[match[2]] || photo.length > 1_048_576) fail(400, 'Ảnh không hợp lệ hoặc vượt quá 1 MB.');
    return { photo, mime: match[1] };
  });
  const unit = zone.id === 'phong-tro' ? 'tháng'
    : zone.id === 'viec-lam' ? (input.attribute === 'Theo tháng' ? 'tháng' : 'giờ') : '';
  const location = remote ? 'Làm từ xa' : ward + ', ' + input.province;
  return { payload: { zone: zone.id, title, detail, location, province: remote ? '' : input.province, ward: remote ? '' : input.ward, remote, delivery, category: input.category, attribute: input.attribute, price: input.price, unit, ...(exchange ? { quantity } : {}) }, photos };
}
const threadFor = (thread, owner) => db.prepare(`
  SELECT t.id FROM threads t JOIN listings l ON t.listing=l.id
  WHERE t.id=? AND (t.buyer=? OR l.owner=?)
`).get(thread, owner, owner);

async function api(req, res, { pathname, searchParams }) {
  const method = req.method;
  if (method !== 'GET') {
    const expected = origin?.origin ?? 'http://' + req.headers.host;
    if (req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Yêu cầu phải đến từ trang chợ.');
  }
  const providerRoute = /^\/api\/oauth\/(google|facebook)\/(start|callback)$/.exec(pathname);
  if (method === 'GET' && providerRoute) {
    if (providerRoute[2] === 'start') limitAuth(req);
    return oauth.route(req, res, providerRoute[1], providerRoute[2], searchParams);
  }
  if (method === 'POST' && pathname === '/api/oauth/complete') {
    limitAuth(req);
    return json(res, { destination: oauth.complete(req, res, await body(req)) });
  }
  if (method === 'POST' && ['/api/register','/api/login'].includes(pathname)) {
    limitAuth(req);
    const input = await body(req);
    const handle = typeof input.handle === 'string' ? input.handle.trim().toLowerCase() : '';
    if (!/^[a-z0-9_]{3,30}$/.test(handle) || typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 128) fail(400, 'Kiểm tra tên tài khoản và mật khẩu.');
    let user = db.prepare('SELECT * FROM accounts WHERE handle=?').get(handle);
    if (pathname === '/api/register') {
      const { name, email, phone } = accountDetails(input);
      const salt = id();
      const password = await derive(input.password, salt, 64);
      user = { id: id(), name, handle };
      const inserted = db.prepare('INSERT OR IGNORE INTO accounts (id,handle,name,salt,password,email,phone) VALUES (?,?,?,?,?,?,?)')
        .run(user.id, handle, name, salt, password, email, phone);
      if (!inserted.changes) fail(409, 'Tên tài khoản đã được dùng.');
    } else {
      const candidate = await derive(input.password, user?.salt ?? 'market-login-invalid', 64);
      if (!user || !timingSafeEqual(candidate, user.password)) fail(401, 'Tên tài khoản hoặc mật khẩu chưa đúng.');
    }
    issueSession(res, user.id);
    return json(res, { name: user.name });
  }
  const user = currentUser(req);
  if (method === 'GET' && pathname === '/api/state') {
    const listings = db.prepare(`
      SELECT id,payload,photo IS NOT NULL AS hasPhoto,
        (SELECT count(*) FROM listing_photos WHERE listing=listings.id) AS extraPhotos
      FROM listings WHERE deleted=0 ORDER BY created DESC,id
    `).all().map(listingData);
    const mine = user ? db.prepare('SELECT id FROM listings WHERE owner=? AND deleted=0').all(user.id).map((row) => row.id) : [];
    const saved = user ? db.prepare('SELECT s.listing FROM saved s JOIN listings l ON l.id=s.listing WHERE s.owner=? AND l.deleted=0').all(user.id).map((row) => row.listing) : [];
    return json(res, { user: user ? { name: user.name, handle: user.handle } : null, listings, mine, saved,
      providers: oauth.providers, pendingSignup: Boolean(oauth.pending(req)) });
  }
  const photoPath = /^\/api\/photos\/([a-f0-9]{32})(?:\/([2-5]))?$/.exec(pathname);
  if (method === 'GET' && photoPath) {
    const [, photoId, position] = photoPath;
    const row = position ? db.prepare(`
      SELECT p.photo,p.mime FROM listing_photos p JOIN listings l ON l.id=p.listing
      WHERE p.listing=? AND p.position=? AND l.deleted=0
    `).get(photoId, Number(position)) : listingRow(photoId);
    if (!row?.photo) fail(404, 'Ảnh không tồn tại.');
    res.writeHead(200, { 'Content-Type': row.mime, 'Cache-Control': 'no-store' });
    return res.end(row.photo);
  }
  if (!user) fail(401, 'Bạn cần đăng nhập.');
  if (method === 'POST' && pathname === '/api/logout') {
    const token = cookieValue(req, cookie);
    db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token));
    res.setHeader('Set-Cookie', `${cookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
    return json(res, {});
  }
  if (method === 'POST' && pathname === '/api/listings') {
    const { payload, photos } = validateListing(await body(req, 7_100_000));
    const listing = id();
    const [cover, ...extras] = photos;
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO listings (id,owner,payload,photo,mime,created) VALUES (?,?,?,?,?,?)')
        .run(listing, user.id, JSON.stringify({ ...payload, seller: user.name }), cover?.photo ?? null, cover?.mime ?? null, now());
      const insert = db.prepare('INSERT INTO listing_photos VALUES (?,?,?,?)');
      extras.forEach(({ photo, mime }, index) => insert.run(listing, index + 2, photo, mime));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return json(res, { id: listing }, 201);
  }
  const target = /^\/api\/(listings|saved)\/([a-f0-9]{32})$/.exec(pathname);
  if (target && method === 'PUT' && target[1] === 'listings') {
    const { quantity } = await body(req);
    if (!validQuantity(quantity)) fail(400, 'Số lượng phải là số nguyên từ 0 đến 9.999.');
    const updated = db.prepare(`
      UPDATE listings SET payload=json_set(payload,'$.quantity',?)
      WHERE id=? AND owner=? AND deleted=0
        AND json_extract(payload,'$.zone') IN ('do-cu','tai-lieu')
    `).run(quantity, target[2], user.id);
    if (!updated.changes) fail(404, 'Không tìm thấy tin bán hàng của bạn.');
    return json(res, { quantity });
  }
  if (target && method === 'DELETE' && target[1] === 'listings') {
    db.exec('BEGIN');
    try {
      const removed = db.prepare('UPDATE listings SET deleted=1,photo=NULL WHERE id=? AND owner=? AND deleted=0').run(target[2], user.id);
      if (!removed.changes) fail(404, 'Không tìm thấy tin của bạn.');
      db.prepare('DELETE FROM listing_photos WHERE listing=?').run(target[2]);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return json(res, {});
  }
  if (target && method === 'PUT' && target[1] === 'saved') {
    if (!listingRow(target[2])) fail(404, 'Tin đã được gỡ.');
    const input = await body(req);
    if (input.saved === true) db.prepare('INSERT OR IGNORE INTO saved VALUES (?,?)').run(user.id, target[2]);
    else db.prepare('DELETE FROM saved WHERE owner=? AND listing=?').run(user.id, target[2]);
    return json(res, {});
  }
  if (method === 'GET' && pathname === '/api/threads') {
    const threads = db.prepare(`
      SELECT t.id, json_extract(l.payload,'$.title') title,
        CASE WHEN t.buyer=? THEN seller.name ELSE buyer.name END name
      FROM threads t JOIN listings l ON l.id=t.listing
      JOIN accounts buyer ON buyer.id=t.buyer JOIN accounts seller ON seller.id=l.owner
      WHERE t.buyer=? OR l.owner=? ORDER BY (SELECT MAX(m.id) FROM messages m WHERE m.thread=t.id) DESC
    `).all(user.id, user.id, user.id);
    return json(res, threads);
  }
  const threadId = /^\/api\/threads\/([a-f0-9]{32})$/.exec(pathname)?.[1];
  if (method === 'GET' && threadId) {
    if (!threadFor(threadId, user.id)) fail(404, 'Không tìm thấy cuộc trò chuyện.');
    return json(res, db.prepare('SELECT a.name, m.sender=? mine,m.body,m.created FROM messages m JOIN accounts a ON a.id=m.sender WHERE m.thread=? ORDER BY m.id').all(user.id, threadId));
  }
  if (method === 'POST' && (pathname === '/api/messages' || threadId)) {
    const input = await body(req);
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!message || message.length > 1000) fail(400, 'Lời nhắn cần từ 1 đến 1.000 ký tự.');
    let thread = threadId;
    if (thread) {
      if (!threadFor(thread, user.id)) fail(404, 'Không tìm thấy cuộc trò chuyện.');
    } else {
      const row = listingRow(String(input.listing ?? ''));
      if (!row || row.owner === user.id) fail(400, 'Chọn một tin còn hoạt động của người khác.');
      db.prepare('INSERT OR IGNORE INTO threads VALUES (?,?,?)').run(id(), row.id, user.id);
      thread = db.prepare('SELECT id FROM threads WHERE listing=? AND buyer=?').get(row.id, user.id).id;
    }
    db.prepare('INSERT INTO messages (thread,sender,body,created) VALUES (?,?,?,?)').run(thread, user.id, message, now());
    return json(res, { thread }, 201);
  }
  fail(404, 'Đường dẫn không tồn tại.');
}

const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp' };
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    if (pathname.startsWith('/api/')) return await api(req, res, url);
    const file = pathname === '/' ? '/index.html' : pathname;
    if (!['GET','HEAD'].includes(req.method) || !/^\/(?:[a-z-]+\.html|(?:Scripts\/market(?:-data|-regions)?\.js|Styles\/market\.css|Images\/[a-zA-Z0-9_.-]+\.(?:jpe?g|png|webp)))$/.test(file)) fail(404, 'Không tìm thấy trang.');
    const fullPath = path.join(__dirname, file);
    if (!fs.existsSync(fullPath)) fail(404, 'Không tìm thấy tệp.');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(fullPath).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    if (error.status == null) console.error(error.message);
    if (!res.headersSent) json(res, { error: error.status ? error.message : 'Máy chủ gặp lỗi.' }, error.status || 500);
  }
});
server.listen(Number(process.env.PORT || 8000), process.env.MARKET_HOST || '127.0.0.1', () => {
  console.log('Chợ Phú Thịnh · cổng ' + server.address().port);
  if (process.platform === 'win32' && process.argv.includes('--open')) {
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    require('node:child_process').execFile(
      'powershell.exe', ['-NoProfile', '-Command', "Start-Process '" + url + "'"],
      { windowsHide: true }, (error) => { if (error) console.log(url); }
    );
  }
});
