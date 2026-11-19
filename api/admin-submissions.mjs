import { list, get, put, del } from '@vercel/blob';
import { requireAdmin, signFileToken } from './_auth.mjs';

function attachSignedUrls(record) {
  const mkUrl = (pathname, filename, download = false) => {
    if (!pathname) return null;
    const token = signFileToken(pathname, 2 * 3600_000);
    const qs = new URLSearchParams({ path: pathname, token });
    if (filename) qs.set('name', filename);
    if (download) qs.set('dl', '1');
    return `/api/admin-file?${qs.toString()}`;
  };

  return {
    ...record,
    clientSign: record.clientSign ? {
      ...record.clientSign,
      imageUrl: record.clientSign.pathname ? mkUrl(record.clientSign.pathname, 'Digitagen-Signature.png', false) : null,
    } : null,
    designerSign: record.designerSign ? {
      ...record.designerSign,
      imageUrl: record.designerSign.pathname ? mkUrl(record.designerSign.pathname, 'Designer-Signature.png', false) : null,
    } : null,
    files: (record.files || []).map(f => ({
      ...f,
      previewUrl: mkUrl(f.pathname, f.name, false),
      downloadUrl: mkUrl(f.pathname, f.name, true),
    })),
  };
}

export async function GET(request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const { blobs } = await list({ prefix: 'submissions/' });
    const records = [];

    for (const b of blobs) {
      if (!b.pathname.endsWith('.json')) continue;
      const res = await get(b.pathname, { access: 'private', useCache: false });
      if (res && res.statusCode === 200 && res.stream) {
        const text = await new Response(res.stream).text();
        try {
          const parsed = JSON.parse(text);
          records.push(attachSignedUrls(parsed));
        } catch {}
      }
    }

    records.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
    return Response.json({ ok: true, submissions: records });
  } catch (err) {
    console.error('Admin list error:', err);
    return Response.json({ error: err?.message || 'Could not load submissions' }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { id, designerName, designerDate, signatureDataUrl } = body || {};
  if (!id || !/^[a-zA-Z0-9_-]{6,64}$/.test(id)) {
    return Response.json({ error: 'Invalid submission ID' }, { status: 400 });
  }

  const recordPath = `submissions/${id}.json`;
  const existingRes = await get(recordPath, { access: 'private', useCache: false });
  if (!existingRes || existingRes.statusCode !== 200) {
    return Response.json({ error: 'Submission not found' }, { status: 404 });
  }

  const record = JSON.parse(await new Response(existingRes.stream).text());

  let sigPathname = record.designerSign?.pathname || null;
  if (signatureDataUrl && typeof signatureDataUrl === 'string' && signatureDataUrl.startsWith('data:image/png;base64,')) {
    const b64 = signatureDataUrl.slice('data:image/png;base64,'.length);
    const buf = Buffer.from(b64, 'base64');
    const saved = await put(`uploads/${id}/signature/Designer-Signature.png`, buf, {
      access: 'private',
      contentType: 'image/png',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    sigPathname = saved.pathname;
  }

  record.designerSign = {
    name: (designerName || '').trim(),
    date: (designerDate || '').trim(),
    pathname: sigPathname,
    signedAt: new Date().toISOString(),
  };
  record.status = 'dual-signed';

  await put(recordPath, JSON.stringify(record, null, 2), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return Response.json({ ok: true, submission: attachSignedUrls(record) });
}

export async function DELETE(request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  if (!id || !/^[a-zA-Z0-9_-]{6,64}$/.test(id)) {
    return Response.json({ error: 'Invalid submission ID' }, { status: 400 });
  }

  const recordPath = `submissions/${id}.json`;
  const toDelete = [recordPath];

  try {
    const { blobs } = await list({ prefix: `uploads/${id}/` });
    blobs.forEach(b => toDelete.push(b.pathname));
    await del(toDelete);
    return Response.json({ ok: true, deletedCount: toDelete.length });
  } catch (err) {
    return Response.json({ error: err?.message || 'Delete failed' }, { status: 500 });
  }
}
