import { get } from '@vercel/blob';
import { verifyAdminPassword, verifyFileToken } from './_auth.mjs';

export async function GET(request) {
  const url = new URL(request.url);
  const pathname = url.searchParams.get('path') || '';
  const token = url.searchParams.get('token') || '';
  const filename = (url.searchParams.get('name') || pathname.split('/').pop() || 'file').replace(/["\r\n]/g, '');
  const forceDownload = url.searchParams.get('dl') === '1';

  const headerPw = request.headers.get('x-admin-password') || '';
  const authorized = verifyAdminPassword(headerPw) || verifyFileToken(pathname, token);
  if (!authorized) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!pathname.startsWith('uploads/') || pathname.includes('..')) {
    return Response.json({ error: 'Invalid file path' }, { status: 400 });
  }

  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', result.blob?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'private, max-age=300');
  const safeAscii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'file';
  headers.set(
    'Content-Disposition',
    `${forceDownload ? 'attachment' : 'inline'}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );

  return new Response(result.stream, { status: 200, headers });
}
