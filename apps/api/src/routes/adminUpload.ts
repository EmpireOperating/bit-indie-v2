import type { FastifyInstance } from 'fastify';

function pageHtml() {
  // Minimal happy-path “admin UI” for uploads.
  // No auth yet; intended for local/dev only.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Marketplace Admin — Uploads</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 24px; }
      h1 { margin: 0 0 12px; }
      .card { border: 1px solid rgba(127,127,127,.35); border-radius: 10px; padding: 16px; margin: 16px 0; }
      label { display: block; font-weight: 600; margin-top: 12px; }
      input[type="text"] { width: min(720px, 100%); padding: 8px; font-size: 14px; }
      input[type="file"] { margin-top: 6px; }
      button { margin-top: 12px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
      pre { background: rgba(127,127,127,.15); padding: 12px; border-radius: 8px; overflow: auto; }
      .muted { opacity: .8; }
      .row { display: flex; gap: 16px; flex-wrap: wrap; align-items: end; }
      .row > * { flex: 1; min-width: 260px; }
    </style>
  </head>
  <body>
    <h1>Marketplace Admin — Uploads</h1>
    <p class="muted">Minimal happy-path UI: select file → request presigned URL → PUT upload → persist key (cover).</p>

    <div class="card">
      <h2>Cover upload</h2>
      <div class="row">
        <div>
          <label for="cover-game-id">Game ID (uuid)</label>
          <input id="cover-game-id" type="text" placeholder="e.g. 3c2a..." />
        </div>
        <div>
          <label for="cover-file">Cover image</label>
          <input id="cover-file" type="file" accept="image/*" />
        </div>
      </div>
      <button id="cover-upload-btn">Upload cover</button>
      <pre id="cover-out">(output)</pre>
    </div>

    <div class="card">
      <h2>Build upload</h2>
      <div class="row">
        <div>
          <label for="build-release-id">Release ID (uuid)</label>
          <input id="build-release-id" type="text" placeholder="e.g. 9b1f..." />
        </div>
        <div>
          <label for="build-file">Build zip</label>
          <input id="build-file" type="file" accept=".zip,application/zip" />
        </div>
      </div>
      <button id="build-upload-btn">Upload build</button>
      <pre id="build-out">(output)</pre>

      <h3>Quick QA</h3>
      <p class="muted">Happy-path: request a presigned download URL, then navigate to it.</p>
      <div class="row">
        <div>
          <label for="dl-buyer-user-id">buyerUserId (uuid)</label>
          <input id="dl-buyer-user-id" type="text" placeholder="optional (requires guestReceiptCode if omitted)" />
        </div>
        <div>
          <label for="dl-guest-receipt-code">guestReceiptCode</label>
          <input id="dl-guest-receipt-code" type="text" placeholder="optional (requires buyerUserId if omitted)" />
        </div>
      </div>
      <button id="build-download-btn">Download latest build</button>
      <pre id="build-download-out">(output)</pre>
    </div>

    <script>
      const qs = (id) => document.getElementById(id);

      async function jsonFetch(path, opts) {
        const res = await fetch(path, {
          headers: { 'content-type': 'application/json', ...(opts?.headers ?? {}) },
          ...opts,
        });
        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text; }
        if (!res.ok) {
          throw new Error('HTTP ' + res.status + ': ' + (typeof body === 'string' ? body : JSON.stringify(body)));
        }
        return body;
      }

      async function putToPresignedUrl(url, file, contentType) {
        const res = await fetch(url, { method: 'PUT', body: file, headers: { 'content-type': contentType } });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error('Upload failed: HTTP ' + res.status + ' ' + text);
        }
      }

      function setOut(el, obj) {
        el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
      }

      qs('cover-upload-btn').addEventListener('click', async () => {
        const out = qs('cover-out');
        setOut(out, 'Working...');

        const gameId = qs('cover-game-id').value.trim();
        const file = qs('cover-file').files?.[0];
        if (!gameId) return setOut(out, 'Missing gameId');
        if (!file) return setOut(out, 'Missing cover file');

        try {
          const presign = await jsonFetch('/storage/presign/cover', {
            method: 'POST',
            body: JSON.stringify({ gameId, contentType: file.type || 'application/octet-stream' }),
          });

          await putToPresignedUrl(presign.uploadUrl, file, file.type || 'application/octet-stream');

          const saved = await jsonFetch('/games/' + encodeURIComponent(gameId), {
            method: 'PUT',
            body: JSON.stringify({ coverObjectKey: presign.objectKey }),
          });

          setOut(out, { ok: true, presign, saved });
        } catch (e) {
          setOut(out, { ok: false, error: String(e?.message ?? e) });
        }
      });

      qs('build-upload-btn').addEventListener('click', async () => {
        const out = qs('build-out');
        setOut(out, 'Working...');

        const releaseId = qs('build-release-id').value.trim();
        const file = qs('build-file').files?.[0];
        if (!releaseId) return setOut(out, 'Missing releaseId');
        if (!file) return setOut(out, 'Missing build file');

        try {
          const presign = await jsonFetch('/releases/' + encodeURIComponent(releaseId) + '/build-upload', {
            method: 'POST',
            body: JSON.stringify({ contentType: file.type || 'application/zip' }),
          });

          await putToPresignedUrl(presign.uploadUrl, file, file.type || 'application/zip');

          setOut(out, { ok: true, presign });
        } catch (e) {
          setOut(out, { ok: false, error: String(e?.message ?? e) });
        }
      });

      qs('build-download-btn').addEventListener('click', async () => {
        const out = qs('build-download-out');
        setOut(out, 'Working...');

        const releaseId = qs('build-release-id').value.trim();
        const buyerUserId = qs('dl-buyer-user-id').value.trim();
        const guestReceiptCode = qs('dl-guest-receipt-code').value.trim();
        if (!releaseId) return setOut(out, 'Missing releaseId');
        if (!buyerUserId && !guestReceiptCode) {
          return setOut(out, 'Provide buyerUserId or guestReceiptCode');
        }

        try {
          const params = new URLSearchParams();
          if (buyerUserId) params.set('buyerUserId', buyerUserId);
          if (guestReceiptCode) params.set('guestReceiptCode', guestReceiptCode);

          const dl = await jsonFetch(
            '/releases/' + encodeURIComponent(releaseId) + '/download?' + params.toString(),
            { method: 'GET' },
          );

          setOut(out, { ok: true, dl, navigatingTo: dl.downloadUrl });
          window.location.href = dl.downloadUrl;
        } catch (e) {
          setOut(out, { ok: false, error: String(e?.message ?? e) });
        }
      });
    </script>
  </body>
</html>`;
}

export async function registerAdminUploadRoutes(app: FastifyInstance) {
  app.get('/admin/uploads', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(pageHtml());
  });
}
