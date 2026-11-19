import { handleUpload } from '@vercel/blob/client';

const BLOCKED_EXT = /\.(exe|bat|cmd|sh|msi|scr|com|pif|vbs|js|mjs|cjs|html|htm|php)$/i;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname || !pathname.startsWith('uploads/') || pathname.includes('..')) {
          throw new Error('Invalid upload path');
        }
        if (BLOCKED_EXT.test(pathname)) {
          throw new Error('This file type is not allowed');
        }
        return {
          maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB per file
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Metadata is linked when the client calls /api/submit
      },
    });
    return Response.json(jsonResponse);
  } catch (err) {
    return Response.json({ error: err?.message || 'Upload token error' }, { status: 400 });
  }
}
