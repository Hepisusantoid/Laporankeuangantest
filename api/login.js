// api/login.js
// Validasi PIN via ENV: ADMIN_PIN

async function handler(req, res) {
  // Health check (bisa dibuka di browser)
  if (req.method === 'GET') {
    const hasEnv = Boolean(process.env.ADMIN_PIN);
    return res.status(200).json({ ok: true, envReady: hasEnv });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // --- Ambil body secara robust ---
  let body = {};
  try {
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else if (typeof req.body === 'string') {
      body = JSON.parse(req.body || '{}');
    } else {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      body = raw ? JSON.parse(raw) : {};
    }
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { pin } = body;
  const adminPin = process.env.ADMIN_PIN;

  if (!adminPin) {
    // ENV belum tersedia di runtime
    return res.status(500).json({ error: 'ADMIN_PIN is not set on server' });
  }

  const ok = String(pin ?? '').trim() === String(adminPin).trim();
  if (ok) return res.status(200).json({ ok: true });

  return res.status(401).json({ error: 'INVALID_PIN' });
}

// Ekspor untuk dua runtime (Vercel Functions & Next.js)
module.exports = handler;
export default handler;
