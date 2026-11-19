import { put, get } from '@vercel/blob';

const NOTIFY_EMAIL = 'ongzixuan123@gmail.com';

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const submissionId = (payload.submissionId && /^[a-zA-Z0-9_-]{6,64}$/.test(payload.submissionId))
    ? payload.submissionId
    : `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const pathname = `submissions/${submissionId}.json`;

  // Check if this submission already exists (edit/update vs first-time submit)
  let existing = null;
  try {
    const prev = await get(pathname, { access: 'private', useCache: false });
    if (prev && prev.statusCode === 200 && prev.stream) {
      existing = JSON.parse(await new Response(prev.stream).text());
    }
  } catch {
    // New submission
  }

  if (existing && (existing.status === 'dual-signed' || existing.lockedByAdmin)) {
    return Response.json(
      {
        error: 'This checklist has already been counter-signed and finalized by the designer. Please WhatsApp +60 18-207 1132 for any further changes.',
        locked: true,
      },
      { status: 409 }
    );
  }

  const rawClientSign = payload.clientSign && typeof payload.clientSign === 'object' ? payload.clientSign : {};
  const safeClientSigPath = (typeof rawClientSign.pathname === 'string' && rawClientSign.pathname.startsWith('uploads/') && !rawClientSign.pathname.includes('..'))
    ? rawClientSign.pathname
    : (existing?.clientSign?.pathname || null);

  // Validate and deduplicate uploaded file references
  const seenPaths = new Set();
  const safeFiles = [];
  if (Array.isArray(payload.files)) {
    for (const f of payload.files) {
      if (!f || typeof f.pathname !== 'string') continue;
      if (!f.pathname.startsWith('uploads/') || f.pathname.includes('..')) continue;
      if (seenPaths.has(f.pathname)) continue;
      seenPaths.add(f.pathname);
      safeFiles.push({
        slot: String(f.slot || 'other').slice(0, 40),
        slotLabel: String(f.slotLabel || f.slot || 'File').slice(0, 80),
        name: String(f.name || 'file').slice(0, 180),
        size: Number(f.size) || 0,
        contentType: String(f.contentType || 'application/octet-stream').slice(0, 120),
        pathname: f.pathname,
      });
    }
  }

  const now = new Date().toISOString();
  const isUpdate = Boolean(existing);
  const version = isUpdate ? (existing.version || 1) + 1 : 1;

  const record = {
    id: submissionId,
    version,
    submittedAt: existing?.submittedAt || now,
    updatedAt: isUpdate ? now : null,
    status: 'awaiting-countersign',
    company: payload.company || {},
    design: payload.design || {},
    domain: payload.domain || {},
    pages: Array.isArray(payload.pages) ? payload.pages : [],
    products: payload.products || {},
    ordering: payload.ordering || {},
    languages: payload.languages || {},
    contentSent: Array.isArray(payload.contentSent) ? payload.contentSent : [],
    marketing: Array.isArray(payload.marketing) ? payload.marketing : [],
    afterLaunch: payload.afterLaunch || {},
    timeline: payload.timeline || {},
    clientSign: {
      name: (rawClientSign.name || '').trim(),
      date: (rawClientSign.date || '').trim(),
      pathname: safeClientSigPath,
    },
    designerSign: existing?.designerSign || null,
    files: safeFiles,
  };

  try {
    await put(pathname, JSON.stringify(record, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.error('Blob save error:', err);
    return Response.json({ error: 'Failed to save submission to storage' }, { status: 500 });
  }

  // Fire a clean lightweight email alert (non-blocking — database save is already complete!)
  try {
    const origin = request.headers.get('origin') || `https://${request.headers.get('host') || 'digitagen-checklist.vercel.app'}`;
    const adminUrl = `${origin}/admin`;
    const fileNames = record.files.map(f => `[${f.slotLabel || f.slot}] ${f.name}`).join(', ') || 'None';
    const subjectPrefix = isUpdate
      ? `Updated Digitagen Checklist (v${version})`
      : 'New Digitagen Checklist Submitted';
    await fetch(`https://formsubmit.co/ajax/${NOTIFY_EMAIL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': origin,
        'Referer': `${origin}/`,
      },
      body: JSON.stringify({
        _subject: `${subjectPrefix} — ${record.design.choice || 'Design 1'} (${record.files.length} files)`,
        _captcha: 'false',
        _template: 'table',
        'Submission ID': submissionId,
        'Version': `v${version}${isUpdate ? ' (Edited by client)' : ' (Initial submission)'}`,
        'Submitted At': record.submittedAt,
        ...(isUpdate ? { 'Updated At': now } : {}),
        'Company': record.company.name || 'Digitagen Sdn Bhd',
        'Contact Person': record.company.contactPerson || '-',
        'Design Selected': record.design.choice || '-',
        'Uploaded Files Count': String(record.files.length),
        'Uploaded Files': fileNames,
        'Open Admin Dashboard (Download Files & Counter-Sign)': adminUrl,
      }),
    }).catch(() => {});
  } catch {
    // Ignore email alert failure; record is safely stored in database
  }

  return Response.json({
    ok: true,
    id: submissionId,
    version,
    isUpdate,
    submittedAt: record.submittedAt,
    updatedAt: record.updatedAt,
    fileCount: record.files.length,
    files: record.files,
    clientSigPathname: safeClientSigPath,
  });
}
