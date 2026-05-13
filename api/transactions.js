// /api/transactions.js
// JSONBin proxy — kompatibel format lama/baru, menyimpan field `sector`,
// dan tidak membatasi saldo (pengeluaran boleh melebihi saldo).

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ENV
  const BIN_ID =
    process.env.JSONBIN_BIN_ID || process.env.NEXT_PUBLIC_JSONBIN_BIN_ID;
  const MASTER =
    process.env.JSONBIN_SECRET_KEY ||
    process.env.JSONBIN_API_KEY ||
    process.env.JSONBIN_MASTER_KEY;

  if (!BIN_ID) return res.status(500).json({ error: 'Missing env JSONBIN_BIN_ID' });
  if (!MASTER) return res.status(500).json({ error: 'Missing env JSONBIN_SECRET_KEY/JSONBIN_API_KEY' });

  const base = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Master-Key': MASTER,
    'X-Access-Key': MASTER,
    'X-Bin-Meta': 'false', // GET akan kembalikan record langsung
  };

  try {
    if (req.method === 'GET') {
      const { list } = await loadList(base, headers);
      return res.status(200).json({ transactions: list });
    }

    // Ambil state untuk operasi tulis
    const { list } = await loadList(base, headers);

    if (req.method === 'POST') {
      const body = await readJSON(req);
      const tx = sanitizeTx(body);
      list.push(tx); // tidak ada pembatasan saldo
      await saveList(base, headers, list);
      return res.status(201).json({ ok: true, tx });
    }

    if (req.method === 'PUT') {
      const body = await readJSON(req);
      const id = body?.id;
      if (!id) return res.status(400).json({ error: 'id required' });

      const idx = list.findIndex(t => t.id === id);
      if (idx === -1) return res.status(404).json({ error: 'not found' });

      const updated = {
        ...list[idx],
        ...body,
        amount: Number(body?.amount ?? list[idx].amount),
        sector: body?.sector ?? list[idx].sector ?? '' // jaga konsistensi
      };
      list[idx] = updated;
      await saveList(base, headers, list);
      return res.status(200).json({ ok: true, updated });
    }

    if (req.method === 'DELETE') {
      const { id } = await readJSON(req);
      if (!id) return res.status(400).json({ error: 'id required' });
      const next = list.filter(t => t.id !== id);
      if (next.length === list.length) return res.status(404).json({ error: 'not found' });
      await saveList(base, headers, next);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}

/* =================== Helpers =================== */
async function readJSON(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}
function sanitizeTx(body){
  return {
    id: body?.id || rid(),
    type: body?.type,                         // 'Pemasukan' | 'Pengeluaran'
    note: body?.note || '',
    sector: body?.sector || '',               // <<— sektor baru (opsional)
    amount: Number(body?.amount || 0),        // angka murni
    date: body?.date || new Date().toISOString().slice(0,10)
  };
}
function rid(){ return 'tx_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

function extractList(record){
  if (Array.isArray(record?.transactions)) return record.transactions; // format baru
  if (Array.isArray(record)) return record;                             // format lama (array)
  return [];
}
async function loadList(base, headers){
  const r = await fetch(`${base}/latest`, { headers, cache:'no-store' });
  if (!r.ok) throw new Error(`GET ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const record = (j && typeof j === 'object' && 'record' in j) ? j.record : j;
  // normalisasi agar tiap item minimal punya field sector
  const list = extractList(record).map(t => ({ ...t, sector: t.sector ?? '' }));
  return { list };
}
async function saveList(base, headers, list){
  // simpan konsisten sebagai { transactions:[...] }
  const r = await fetch(base, {
    method:'PUT', headers, body: JSON.stringify({ transactions: list })
  });
  if (!r.ok) throw new Error(`PUT ${r.status}: ${await r.text()}`);
  return r.json();
    }
