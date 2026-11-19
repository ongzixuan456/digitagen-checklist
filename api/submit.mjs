import { put } from '@vercel/blob';

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

  const rawClientSign = payload.clientSign && typeof payload.clientSign === 'object' ? payload.clientSign : {};
  const safeClientSigPath = (typeof rawClientSign.pathname === 'string' && rawClientSign.pathname.startsWith('uploads/') && !rawClientSign.pathname.includes('..'))
    ? rawClientSign.pathname
    : null;

  const now = new Date().toISOString();
  const record = {
    id: submissionId,
    submittedAt: now,
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
    designerSign: null,
    files: Array.isArray(payload.files)
      ? payload.files.filter(f => f && typeof f.pathname === 'string' && f.pathname.startsWith('uploads/') && !f.pathname.includes('..'))
      : [],
  };

  const pathname = `submissions/${submissionId}.json`;
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
    await fetch(`https://formsubmit.co/ajax/${NOTIFY_EMAIL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': origin,
        'Referer': `${origin}/`,
      },
      body: JSON.stringify({
        _subject: `New Digitagen Checklist Submitted — ${record.design.choice || 'Design 1'} (${record.files.length} files)`,
        _captcha: 'false',
        _template: 'table',
        'Submission ID': submissionId,
        'Submitted At': now,
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

  return Response.json({ ok: true, id: submissionId, submittedAt: now, fileCount: record.files.length });
}
