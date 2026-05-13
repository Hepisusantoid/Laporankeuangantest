/* =========================
   Laporan Keuangan – script.js v6
   Fitur baru:
   - Search transaksi (keterangan + sektor)
   - Filter sektor dinamis
   - Filter jenis (Pemasukan/Pengeluaran)
   - Kategori preset di form
   - Chart Top 5 Pengeluaran
   - Toggle dark/light theme
   - Export CSV
   - Toast notification
   - Confirm dialog kustom
   - Badge jumlah data
   - Chip jenis (Pemasukan/Pengeluaran)
   - Kalkulator dengan tombol "Pakai Angka"
   ========================= */

//// ---------- Config ----------
const API_TX     = '/api/transactions';
const SESSION_KEY = 'lapkeu_session';
const THEME_KEY   = 'lapkeu_theme';

//// ---------- State ----------
let state = { transactions: [] };
let currentMonthFilter  = 'ALL';
let currentTypeFilter   = 'ALL';
let currentSectorFilter = 'ALL';
let searchQuery         = '';
let pendingDeleteId     = null;
let chartPeriodMode     = 'filter'; // 'filter' | 'all'

//// ---------- Helpers ----------
const $ = (s) => document.querySelector(s);
const el = (t, a = {}, kids = []) => {
  const n = document.createElement(t);
  Object.entries(a).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  });
  kids.forEach((k) => n.appendChild(k));
  return n;
};
const fmtIDR = (n) =>
  (n || 0).toLocaleString('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  });

function parseIDR(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}
function formatThousandsInput(s) {
  s = String(s || '').replace(/[^\d,]/g, '');
  const parts = s.split(',');
  let int = parts[0].replace(/^0+(?=\d)/, '');
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return parts.length > 1 ? `${int},${parts[1].slice(0, 2)}` : int;
}
function formatFromNumber(n) {
  return Math.round(n || 0).toLocaleString('id-ID');
}
function attachThousandsMask(inp) {
  inp?.addEventListener('input', () => {
    const pos = inp.selectionStart;
    const before = inp.value.length;
    inp.value = formatThousandsInput(inp.value);
    const after = inp.value.length;
    inp.selectionStart = inp.selectionEnd = Math.max(0, pos + (after - before));
  });
}
const monthKey = (d) => (d || '').slice(0, 7);
const yearKey  = (d) => (d || '').slice(0, 4);
const sectorLabel = (v) => (v && String(v).trim()) ? String(v).trim() : 'Tanpa Sektor';
function toIndoMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const id = ['','Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return `${id[m]} ${y}`;
}
function listMonths(list) {
  const s = new Set(list.map((t) => monthKey(t.date)));
  return Array.from(s).filter(Boolean).sort().reverse();
}
function computeSums(list) {
  const IN  = list.filter(t => t.type === 'Pemasukan').reduce((a, b) => a + b.amount, 0);
  const OUT = list.filter(t => t.type === 'Pengeluaran').reduce((a, b) => a + b.amount, 0);
  return { sumIn: IN, sumOut: OUT, balance: IN - OUT };
}

//// ---------- Toast ----------
function toast(msg, type = 'success') {
  const tc = $('#toast-container');
  if (!tc) return;
  const t = el('div', { class: `toast ${type}`, text: msg });
  tc.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(12px) scale(.9)';
    t.style.transition = 'all .25s ease';
    setTimeout(() => t.remove(), 280);
  }, 2200);
}

//// ---------- Theme ----------
function applyTheme(mode) {
  document.body.classList.toggle('light', mode === 'light');
  const btn = $('#btn-theme');
  if (btn) btn.textContent = mode === 'light' ? '🌙' : '☀️';
  localStorage.setItem(THEME_KEY, mode);
  // update chart defaults
  if (window.Chart) {
    Chart.defaults.color = mode === 'light' ? '#3d6b50' : '#c2deca';
    Chart.defaults.borderColor = mode === 'light' ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.10)';
  }
}
$('#btn-theme')?.addEventListener('click', () => {
  const isLight = document.body.classList.contains('light');
  applyTheme(isLight ? 'dark' : 'light');
  // redraw charts
  if (state.transactions.length) {
    const list = getChartList();
    updateAnalytics(list);
  }
});
// init theme
applyTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark');

//// ---------- Auth UI ----------
function updateAuthUI() {
  const on = !!localStorage.getItem(SESSION_KEY);
  $('#screen-login')?.classList.toggle('hidden', on);
  $('#screen-app')?.classList.toggle('hidden', !on);
  const btnLogin  = $('#btn-login');
  const btnLogout = $('#btn-logout');
  const btnExport = $('#btn-export');
  if (btnLogin)  btnLogin.hidden  = on;
  if (btnLogout) btnLogout.hidden = !on;
  if (btnExport) btnExport.hidden = !on;
}
$('#btn-logout')?.addEventListener('click', () => {
  localStorage.removeItem(SESSION_KEY);
  updateAuthUI();
  toast('Berhasil keluar', 'success');
});
$('#btn-login')?.addEventListener('click', () =>
  $('#screen-login')?.scrollIntoView({ behavior: 'smooth' })
);

//// ---------- API ----------
async function apiGet() {
  const r = await fetch(API_TX, { method: 'GET' });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  if (Array.isArray(j)) return { transactions: j };
  if (Array.isArray(j?.transactions)) return j;
  return { transactions: [] };
}
async function apiPost(tx) {
  const r = await fetch(API_TX, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tx),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Gagal menyimpan');
  return j;
}
async function apiPut(tx) {
  const r = await fetch(API_TX, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tx),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Gagal memperbarui');
  return j;
}
async function apiDelete(id) {
  const r = await fetch(API_TX, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Gagal menghapus');
  return j;
}

//// ---------- Filter & Search ----------
function applyFilter(list) {
  let out = list;
  if (currentMonthFilter !== 'ALL')
    out = out.filter(t => monthKey(t.date) === currentMonthFilter);
  if (currentTypeFilter !== 'ALL')
    out = out.filter(t => t.type === currentTypeFilter);
  if (currentSectorFilter !== 'ALL')
    out = out.filter(t => sectorLabel(t.sector) === currentSectorFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    out = out.filter(t =>
      (t.note || '').toLowerCase().includes(q) ||
      sectorLabel(t.sector).toLowerCase().includes(q) ||
      (t.date || '').includes(q)
    );
  }
  return out;
}

function getChartList() {
  return chartPeriodMode === 'all' ? state.transactions : applyFilter(state.transactions);
}

function updateSectorFilter(list) {
  const sel = $('#filter-sector');
  if (!sel) return;
  const sectors = [...new Set(list.map(t => sectorLabel(t.sector)))].sort();
  const prev = sel.value;
  sel.innerHTML = '<option value="ALL">Semua Sektor</option>';
  sectors.forEach(s => {
    const o = el('option', { value: s, text: s });
    sel.appendChild(o);
  });
  sel.value = sectors.includes(prev) ? prev : 'ALL';
}

//// ---------- Render ----------
function render() {
  const filtered = applyFilter(state.transactions).sort((a, b) => a.date < b.date ? 1 : -1);
  const { sumIn, sumOut, balance } = computeSums(filtered);

  // Stats
  animateValue('#sum-in',      sumIn);
  animateValue('#sum-out',     sumOut);
  animateValue('#sum-balance', balance);

  // Filter bulan
  const sel = $('#filter-month');
  if (sel) {
    const months = listMonths(state.transactions);
    const prev = sel.value;
    sel.innerHTML = '<option value="ALL">Semua Bulan</option>';
    months.forEach(m => sel.appendChild(el('option', { value: m, text: toIndoMonth(m) })));
    sel.value = months.includes(prev) ? prev : currentMonthFilter;
  }

  // Update sektor filter options
  updateSectorFilter(state.transactions);

  // Badge jumlah
  const badge = $('#tx-count');
  if (badge) badge.textContent = `${filtered.length} data`;

  // Tabel transaksi
  const tbody = $('#tbody');
  const emptyEl = $('#empty-tx');
  if (tbody) {
    tbody.innerHTML = '';
    if (filtered.length === 0) {
      emptyEl?.classList.remove('hidden');
    } else {
      emptyEl?.classList.add('hidden');
      filtered.forEach(t => {
        const isIn = t.type === 'Pemasukan';
        const tr = el('tr', {}, [
          el('td', { text: t.date }),
          el('td', { text: t.note || '-' }),
          el('td', {}, [el('span', { class: 'muted', text: sectorLabel(t.sector) })]),
          el('td', {}, [
            el('span', { class: `chip ${isIn ? 'in' : 'out'}`, text: t.type })
          ]),
          el('td', {
            class: 'right',
            style: `color:${isIn ? 'var(--income-color)' : 'var(--expense-color)'};font-family:var(--mono);font-weight:700`,
            text: (isIn ? '+' : '-') + fmtIDR(t.amount)
          }),
          el('td', {}, [
            smallBtn('✏️', () => openEdit(t)),
            smallDanger('🗑️', () => openConfirmDelete(t)),
          ]),
        ]);
        tbody.appendChild(tr);
      });
    }
  }

  const chartList = getChartList();
  updateAnalytics(chartList);
  renderReports(state.transactions);
  initCollapsibles();
}

// Animasi nilai stat cards
function animateValue(selector, target) {
  const el = $(selector);
  if (!el) return;
  el.textContent = fmtIDR(target);
  el.style.transform = 'scale(1.05)';
  el.style.transition = 'transform .2s ease';
  setTimeout(() => { el.style.transform = 'scale(1)'; }, 200);
}

function smallBtn(txt, fn) {
  const b = el('button', { class: 'btn sm', text: txt });
  b.addEventListener('click', fn);
  return b;
}
function smallDanger(txt, fn) {
  const b = el('button', { class: 'btn sm danger', text: txt });
  b.addEventListener('click', fn);
  return b;
}

//// ---------- Confirm Delete Modal ----------
function openConfirmDelete(t) {
  pendingDeleteId = t.id;
  const desc = $('#confirm-desc');
  if (desc) desc.textContent = `"${t.note || t.type}" – ${fmtIDR(t.amount)}`;
  $('#modal-confirm')?.showModal();
}
$('#confirm-no')?.addEventListener('click',  () => { $('#modal-confirm')?.close(); pendingDeleteId = null; });
$('#confirm-yes')?.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  $('#modal-confirm')?.close();
  try {
    await apiDelete(pendingDeleteId);
    pendingDeleteId = null;
    await loadData();
    toast('Transaksi berhasil dihapus', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
});

//// ---------- Modal Tambah/Edit ----------
const dlg = $('#modal-tx');

// Type toggle
document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('#tx-type').value = btn.dataset.val;
  });
});

// Sector preset sync
$('#tx-sector-preset')?.addEventListener('change', (e) => {
  if (e.target.value) $('#tx-sector').value = e.target.value;
});
$('#tx-sector')?.addEventListener('input', () => {
  $('#tx-sector-preset').value = '';
});

$('#open-add')?.addEventListener('click', () => {
  $('#modal-title').textContent = 'Tambah Transaksi Baru';
  $('#tx-id').value = '';
  // reset type toggle
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.type-btn[data-val="Pemasukan"]')?.classList.add('active');
  $('#tx-type').value = 'Pemasukan';
  $('#tx-note').value = '';
  $('#tx-sector').value = '';
  $('#tx-sector-preset').value = '';
  $('#tx-amount').value = '';
  $('#tx-date').valueAsDate = new Date();
  $('#form-error').hidden = true;
  dlg.showModal();
});

$('#btn-cancel')?.addEventListener('click', () => dlg.close());

function openEdit(t) {
  $('#modal-title').textContent = 'Edit Transaksi';
  $('#tx-id').value = t.id;
  // type toggle
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.type-btn[data-val="${t.type}"]`)?.classList.add('active');
  $('#tx-type').value = t.type;
  $('#tx-note').value = t.note || '';
  $('#tx-sector').value = t.sector || '';
  $('#tx-sector-preset').value = '';
  $('#tx-amount').value = formatFromNumber(t.amount);
  $('#tx-date').value = t.date;
  $('#form-error').hidden = true;
  dlg.showModal();
}

$('#form-tx')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    id:     $('#tx-id').value || undefined,
    type:   $('#tx-type').value,
    note:   $('#tx-note').value.trim(),
    sector: $('#tx-sector').value.trim(),
    amount: parseIDR($('#tx-amount').value),
    date:   $('#tx-date').value,
  };
  if (!data.amount || data.amount <= 0) return showFormError('Jumlah harus lebih dari 0');
  if (!data.date) return showFormError('Tanggal harus diisi');

  const submitBtn = $('#form-tx button[type=submit]');
  if (submitBtn) { submitBtn.textContent = '⏳ Menyimpan...'; submitBtn.disabled = true; }

  try {
    if (data.id) await apiPut(data);
    else await apiPost(data);
    dlg.close();
    await loadData();
    toast(data.id ? 'Transaksi diperbarui ✓' : 'Transaksi ditambahkan ✓', 'success');
  } catch (err) {
    showFormError(err.message);
  } finally {
    if (submitBtn) { submitBtn.textContent = '💾 Simpan'; submitBtn.disabled = false; }
  }
});

function showFormError(m) {
  const e = $('#form-error');
  e.textContent = '⚠️ ' + m;
  e.hidden = false;
}
attachThousandsMask($('#tx-amount'));

//// ---------- Kalkulator ----------
const dlgCalc  = $('#modal-calc');
const disp     = $('#calc-display');
const histEl   = $('#calc-history');
let calcExpr   = '0';
let lastResult = null;

const fmtComma = (n) => {
  if (!/^\-?\d+(\.\d+)?$/.test(n)) return n;
  const [i, d] = n.split('.');
  const t = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${t},${d}` : t;
};
const human = (e) => e.replace(/(?<![A-Za-z])\-?\d+(\.\d+)?/g, (m) => fmtComma(m));
const updCalc = () => { if (disp) disp.value = human(calcExpr); };

function pushCalc(tok) {
  if (tok === 'C') { calcExpr = '0'; if (histEl) histEl.textContent = ''; return updCalc(); }
  if (tok === '⌫') { calcExpr = calcExpr.length <= 1 ? '0' : calcExpr.slice(0, -1); return updCalc(); }
  if (tok === '=') {
    try {
      const raw = calcExpr;
      // eslint-disable-next-line no-new-func
      const result = String(Function('"use strict";return (' + raw + ')')() ?? 0);
      if (histEl) histEl.textContent = human(raw) + ' =';
      lastResult = parseFloat(result);
      calcExpr = result;
    } catch { calcExpr = '0'; }
    return updCalc();
  }
  if (calcExpr === '0' && /\d/.test(tok)) calcExpr = tok;
  else calcExpr += tok;
  updCalc();
}

$('#open-calc')?.addEventListener('click', () => dlgCalc.showModal());
$('#close-calc')?.addEventListener('click', () => dlgCalc.close());
document.querySelectorAll('.calc-grid button').forEach(b => {
  if (b.hasAttribute('data-clear')) b.addEventListener('click', () => pushCalc('C'));
  else b.addEventListener('click', () => pushCalc(b.textContent));
});

// Tombol "Pakai Angka"
$('#calc-use')?.addEventListener('click', () => {
  const val = lastResult ?? parseFloat(calcExpr.replace(',', '.')) ?? 0;
  if (val > 0) {
    $('#tx-amount').value = formatFromNumber(val);
    dlgCalc.close();
    dlg.showModal();
    toast(`Angka ${fmtIDR(val)} dimasukkan ke form`, 'success');
  } else {
    toast('Hitung dulu angkanya dengan tombol =', 'error');
  }
});

//// ---------- Export CSV ----------
$('#btn-export')?.addEventListener('click', () => {
  const filtered = applyFilter(state.transactions).sort((a,b) => a.date < b.date ? 1 : -1);
  if (!filtered.length) { toast('Tidak ada data untuk diekspor', 'error'); return; }
  const header = ['Tanggal', 'Keterangan', 'Sektor', 'Jenis', 'Jumlah'];
  const rows = filtered.map(t => [
    t.date,
    `"${(t.note||'').replace(/"/g,'""')}"`,
    `"${sectorLabel(t.sector).replace(/"/g,'""')}"`,
    t.type,
    t.amount
  ]);
  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date().toISOString().slice(0,10);
  a.download = `laporan-keuangan-${d}.csv`;
  a.click();
  toast(`${filtered.length} data diekspor ke CSV ✓`, 'success');
});

//// ---------- Filter Events ----------
$('#filter-month')?.addEventListener('change', e => { currentMonthFilter = e.target.value; render(); });
$('#filter-type')?.addEventListener('change',  e => { currentTypeFilter  = e.target.value; render(); });
$('#filter-sector')?.addEventListener('change',e => { currentSectorFilter = e.target.value; render(); });

// Search
$('#search-input')?.addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  const clearBtn = $('#clear-search');
  if (clearBtn) clearBtn.classList.toggle('hidden', !searchQuery);
  render();
});
$('#clear-search')?.addEventListener('click', () => {
  $('#search-input').value = '';
  searchQuery = '';
  $('#clear-search')?.classList.add('hidden');
  render();
});

// Chart period toggle
document.querySelectorAll('.ctab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ctab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chartPeriodMode = btn.dataset.period;
    const chartList = getChartList();
    updateAnalytics(chartList);
  });
});

//// ---------- Tabs ----------
function initTabs() {
  document.querySelectorAll('.tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tabpane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.querySelector(btn.dataset.target);
      pane?.classList.add('active');
    });
  });
}
initTabs();

//// ---------- Collapsible Tables ----------
function initCollapsibles() {
  document.querySelectorAll('.table-block').forEach(block => {
    const btn  = block.querySelector('.toggle-full');
    const wrap = block.querySelector('.table-wrap');
    if (!btn || !wrap) return;
    btn.onclick = () => {
      wrap.classList.toggle('limited');
      btn.textContent = wrap.classList.contains('limited') ? 'Lihat semua' : 'Tutup';
    };
  });
}

//// ---------- Charts ----------
let chartBalance, chartMonthly, chartShare, chartIncomeSector, chartExpenseSector, chartMonthlyLine, chartTopExpense;

function chartTextColor() {
  return document.body.classList.contains('light') ? '#3d6b50' : '#c2deca';
}
function chartGridColor() {
  return document.body.classList.contains('light') ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.08)';
}

if (window.Chart) {
  Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.borderRadius = 4;
}

function toggleNoData(canvasId, empty) {
  const wrap = document.getElementById(canvasId)?.parentElement;
  const nd   = wrap?.querySelector('.nodata');
  if (!wrap || !nd) return;
  if (empty) nd.classList.remove('hidden');
  else nd.classList.add('hidden');
}

function updateAnalytics(list) {
  const txtColor  = chartTextColor();
  const gridColor = chartGridColor();

  // Saldo kumulatif
  const byDate = {};
  list.forEach(t => {
    const delta = t.type === 'Pemasukan' ? +t.amount : -t.amount;
    byDate[t.date] = (byDate[t.date] || 0) + delta;
  });
  const dates = Object.keys(byDate).sort();
  let run = 0;
  const saldo = dates.map(d => (run += byDate[d]));
  drawBalanceChart(dates, saldo, txtColor, gridColor);

  // Bulanan aggregasi
  const byMonth = {};
  list.forEach(t => {
    const m = monthKey(t.date);
    if (!byMonth[m]) byMonth[m] = { in: 0, out: 0 };
    if (t.type === 'Pemasukan') byMonth[m].in += t.amount;
    else byMonth[m].out += t.amount;
  });
  const months  = Object.keys(byMonth).sort();
  const labels  = months.map(toIndoMonth);
  const arrIn   = months.map(m => byMonth[m].in);
  const arrOut  = months.map(m => byMonth[m].out);
  const arrNet  = months.map((_, i) => arrIn[i] - arrOut[i]);

  drawMonthlyBar(labels, arrIn, arrOut, txtColor, gridColor);
  drawMonthlyLine(labels, arrIn, arrOut, arrNet, txtColor, gridColor);

  // Komposisi total
  const { sumIn, sumOut } = computeSums(list);
  drawShareChart([sumIn, sumOut], txtColor);

  // Sektor
  const secIn = {}, secOut = {};
  list.forEach(t => {
    const s = sectorLabel(t.sector);
    if (t.type === 'Pemasukan') secIn[s]  = (secIn[s]  || 0) + t.amount;
    else                         secOut[s] = (secOut[s] || 0) + t.amount;
  });
  drawSector('chartIncomeSector',  secIn,  txtColor);
  drawSector('chartExpenseSector', secOut, txtColor);

  // Top 5 pengeluaran terbesar
  drawTopExpense(list, txtColor, gridColor);
}

// --- Chart functions ---
function drawBalanceChart(labels, data, txtColor, gridColor) {
  const c = $('#chartBalance');
  if (!c || !window.Chart) return;
  toggleNoData('chartBalance', labels.length === 0);
  chartBalance?.destroy();
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 260);
  g.addColorStop(0, 'rgba(34,224,122,.35)');
  g.addColorStop(1, 'rgba(34,224,122,0)');
  chartBalance = new Chart(c, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Saldo Kumulatif',
        data,
        tension: .35, fill: true,
        backgroundColor: g,
        borderColor: '#22e07a',
        borderWidth: 2,
        pointRadius: data.length < 30 ? 4 : 0,
        pointBackgroundColor: '#22e07a',
        pointHoverRadius: 6,
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: v => fmtIDR(v.parsed.y) } }
      },
      scales: {
        x: { ticks: { color: txtColor, maxTicksLimit: 10, maxRotation: 30 }, grid: { color: gridColor } },
        y: { ticks: { color: txtColor, callback: v => (v/1e6 >= 1 ? (v/1e6).toFixed(1)+'jt' : v.toLocaleString('id-ID')) }, grid: { color: gridColor } }
      }
    }
  });
}

function drawMonthlyBar(labels, inD, outD, txtColor, gridColor) {
  const c = $('#chartMonthly');
  if (!c) return;
  toggleNoData('chartMonthly', labels.length === 0);
  chartMonthly?.destroy();
  chartMonthly = new Chart(c, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Pemasukan',   data: inD,  backgroundColor: 'rgba(34,224,122,.80)',  borderRadius: 8, barPercentage: .7, categoryPercentage: .7 },
        { label: 'Pengeluaran', data: outD, backgroundColor: 'rgba(255,94,94,.80)',   borderRadius: 8, barPercentage: .7, categoryPercentage: .7 },
      ]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: txtColor } },
        tooltip: { callbacks: { label: v => `${v.dataset.label}: ${fmtIDR(v.parsed.y)}` } }
      },
      scales: {
        x: { ticks: { color: txtColor, maxRotation: 30, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: txtColor, callback: v => v.toLocaleString('id-ID') }, grid: { color: gridColor } }
      }
    }
  });
}

function drawMonthlyLine(labels, inD, outD, netD, txtColor, gridColor) {
  const c = $('#chartMonthlyLine');
  if (!c) return;
  toggleNoData('chartMonthlyLine', labels.length === 0);
  chartMonthlyLine?.destroy();
  chartMonthlyLine = new Chart(c, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Pemasukan',    data: inD,  borderColor: '#22e07a', backgroundColor: 'rgba(34,224,122,.08)', tension: .35, pointRadius: 3, fill: false },
        { label: 'Pengeluaran',  data: outD, borderColor: '#ff5e5e', backgroundColor: 'rgba(255,94,94,.08)',  tension: .35, pointRadius: 3, fill: false },
        { label: 'Saldo In-Out', data: netD, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,.08)', tension: .35, pointRadius: 3, fill: false, borderDash: [5,3] },
      ]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: txtColor, padding: 14 } },
        tooltip: { callbacks: { label: v => `${v.dataset.label}: ${fmtIDR(v.parsed.y)}` } }
      },
      scales: {
        x: { ticks: { color: txtColor, maxRotation: 30, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: txtColor, callback: v => v.toLocaleString('id-ID') }, grid: { color: gridColor } }
      }
    }
  });
}

function drawShareChart(vals, txtColor) {
  const c = $('#chartShare');
  if (!c) return;
  const tot = (vals[0] || 0) + (vals[1] || 0);
  toggleNoData('chartShare', tot === 0);
  chartShare?.destroy();
  const centerTextPlugin = {
    id: 'centerText',
    afterDraw(ch) {
      const { ctx, chartArea: { width, height } } = ch;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = txtColor;
      const pIn  = tot ? ((vals[0] / tot) * 100).toFixed(0) : 0;
      const pOut = tot ? ((vals[1] / tot) * 100).toFixed(0) : 0;
      ctx.font = '800 13px Plus Jakarta Sans, system-ui';
      ctx.fillText(`${pIn}% IN`, width / 2, height / 2 - 8);
      ctx.fillText(`${pOut}% OUT`, width / 2, height / 2 + 12);
      ctx.restore();
    }
  };
  chartShare = new Chart(c, {
    type: 'doughnut',
    data: {
      labels: ['Pemasukan', 'Pengeluaran'],
      datasets: [{ data: vals, backgroundColor: ['#22e07a', '#ff5e5e'], borderWidth: 0, hoverOffset: 8 }]
    },
    options: {
      cutout: '68%', maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: txtColor } },
        tooltip: { callbacks: { label: v => `${v.label}: ${fmtIDR(v.parsed)} (${((v.parsed/tot)*100||0).toFixed(1)}%)` } }
      }
    },
    plugins: [centerTextPlugin]
  });
}

function drawSector(id, dict, txtColor) {
  const c = document.getElementById(id);
  if (!c) return;
  const labels = Object.keys(dict).sort((a,b) => dict[b] - dict[a]);
  const vals   = labels.map(k => dict[k]);
  const tot    = vals.reduce((a,b) => a+b, 0);
  toggleNoData(id, labels.length === 0);
  const prev = id === 'chartIncomeSector' ? chartIncomeSector : chartExpenseSector;
  prev?.destroy();
  const COLORS = ['#22e07a','#38bdf8','#f5c842','#a78bfa','#fb923c','#f472b6','#34d399','#60a5fa'];
  const inst = new Chart(c, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: vals, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      cutout: '58%', maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: txtColor, padding: 10 } },
        tooltip: { callbacks: { label: v => `${v.label}: ${fmtIDR(v.parsed)} (${((v.parsed/tot)*100||0).toFixed(1)}%)` } }
      }
    }
  });
  if (id === 'chartIncomeSector') chartIncomeSector = inst;
  else chartExpenseSector = inst;
}

function drawTopExpense(list, txtColor, gridColor) {
  const c = $('#chartTopExpense');
  if (!c) return;
  const expenses = list
    .filter(t => t.type === 'Pengeluaran')
    .sort((a,b) => b.amount - a.amount)
    .slice(0, 5);
  toggleNoData('chartTopExpense', expenses.length === 0);
  chartTopExpense?.destroy();
  if (!expenses.length) return;
  const labels = expenses.map(t => (t.note || t.sector || 'Tanpa Nama').slice(0, 20));
  const data   = expenses.map(t => t.amount);
  chartTopExpense = new Chart(c, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Pengeluaran',
        data,
        backgroundColor: data.map((_, i) => `rgba(255,94,94,${1 - i * 0.15})`),
        borderRadius: 10,
        barPercentage: .65,
      }]
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: v => fmtIDR(v.parsed.x) } }
      },
      scales: {
        x: { ticks: { color: txtColor, callback: v => v.toLocaleString('id-ID') }, grid: { color: gridColor } },
        y: { ticks: { color: txtColor }, grid: { display: false } }
      }
    }
  });
}

window.addEventListener('resize', () => {
  chartBalance?.resize();
  chartMonthly?.resize();
  chartShare?.resize();
  chartMonthlyLine?.resize();
  chartIncomeSector?.resize();
  chartExpenseSector?.resize();
  chartTopExpense?.resize();
});

//// ---------- Laporan Ringkas ----------
function renderReports(all) {
  const gD = groupBy(all, t => t.date);
  const gW = groupBy(all, t => isoWeekKey(t.date));
  const gM = groupBy(all, t => monthKey(t.date));
  const gY = groupBy(all, t => yearKey(t.date));

  fillReport('#tb-harian',    sortKeys(gD).slice(-30),  k => k);
  fillReport('#tb-mingguan',  sortKeys(gW).slice(-20),  k => k);
  fillReport('#tb-bulanan',   sortKeys(gM).slice(-24),  k => toIndoMonth(k));
  fillReport('#tb-tahunan',   sortKeys(gY),              k => k);
}

function groupBy(list, key) {
  const m = {};
  list.forEach(t => {
    const k = key(t);
    if (!m[k]) m[k] = { in: 0, out: 0 };
    if (t.type === 'Pemasukan') m[k].in += t.amount;
    else m[k].out += t.amount;
  });
  return m;
}
function sortKeys(m) {
  return Object.keys(m).sort((a,b) => a < b ? -1 : 1).map(k => ({ key: k, ...m[k] }));
}
function fillReport(sel, rows, lab) {
  const tb = $(sel);
  if (!tb) return;
  tb.innerHTML = '';
  if (!rows.length) {
    tb.appendChild(el('tr', {}, [
      el('td', { colspan: '4', style: 'text-align:center;color:var(--muted-2);padding:16px', text: 'Belum ada data' })
    ]));
    return;
  }
  rows.forEach(r => {
    const saldo = r.in - r.out;
    tb.appendChild(el('tr', {}, [
      el('td', { text: lab(r.key) }),
      el('td', { class: 'right', text: fmtIDR(r.in) }),
      el('td', { class: 'right', text: fmtIDR(r.out) }),
      el('td', { class: 'right', text: fmtIDR(saldo) }),
    ]));
  });
}
function isoWeekKey(s) {
  const d   = new Date(s + 'T00:00:00');
  const day = (d.getUTCDay() + 6) % 7;
  const th  = new Date(d);
  th.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(th.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((th - firstThu) / 86400000 - 3) / 7);
  return `${th.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}

//// ---------- Boot ----------
async function loadData() {
  try {
    const data = await apiGet();
    state = { transactions: Array.isArray(data.transactions) ? data.transactions : [] };
    render();
  } catch (e) {
    toast('Gagal mengambil data: ' + e.message, 'error');
  }
}

updateAuthUI();
if (localStorage.getItem(SESSION_KEY)) loadData();
