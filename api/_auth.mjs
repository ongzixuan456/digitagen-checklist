import crypto from 'node:crypto';

function getSecret() {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error('ADMIN_PASSWORD is not configured');
  return pw;
}

export function verifyAdminPassword(candidate) {
  if (!candidate || typeof candidate !== 'string') return false;
  const expected = getSecret();
  const h1 = crypto.createHash('sha256').update(candidate).digest();
  const h2 = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(h1, h2);
}

export function requireAdmin(request) {
  const pw = request.headers.get('x-admin-password') || '';
  if (!verifyAdminPassword(pw)) {
    return Response.json({ error: 'Invalid admin password' }, { status: 401 });
  }
  return null;
}

export function signFileToken(pathname, expiresMs = 3600_000) {
  const exp = Date.now() + expiresMs;
  const payload = `${pathname}|${exp}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  return `${exp}.${sig}`;
}

export function verifyFileToken(pathname, token) {
  if (!pathname || !token || typeof token !== 'string') return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  const payload = `${pathname}|${exp}`;
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
