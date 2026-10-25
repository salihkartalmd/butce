// Arayüz katmanı. Tüm hesaplar calc.js'teki saf fonksiyonlardan gelir.
import * as C from './calc.js';

const STORE_KEY = 'butce-takip:v1';
const VERSION = '1.0.0';
const DEFAULT_CATEGORIES = [
  { id: 'yemek', name: 'Yemek', emoji: '🍽️' },
  { id: 'ulasim', name: 'Ulaşım', emoji: '🚌' },
  { id: 'market', name: 'Market', emoji: '🛒' },
  { id: 'kahve', name: 'Kahve/Atıştırmalık', emoji: '☕' },
  { id: 'kirtasiye', name: 'Kırtasiye/Kitap', emoji: '📚' },
  { id: 'eglence', name: 'Eğlence', emoji: '🎬' },
  { id: 'giyim', name: 'Giyim', emoji: '👕' },
  { id: 'diger', name: 'Diğer', emoji: '📦' },
];
const TITLES = { today: 'Bugün', history: 'Hareketler', analysis: 'Analiz', settings: 'Ayarlar' };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = (k, o) => C.formatTL(k, o);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const buzz = (ms = 8) => { try { navigator.vibrate?.(ms); } catch {} };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Durum ----------
function freshState() {
  return {
    version: 1,
    settings: { endDay: 15, endInclusive: false, carryOver: true, theme: 'system', categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })) },
    period: null,
    transactions: [],
    archive: [],
    ui: { lastCat: 'yemek', newPeriod: false },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    const f = freshState();
    return { ...f, ...s, settings: { ...f.settings, ...s.settings }, ui: { ...f.ui, ...s.ui } };
  } catch {
    return freshState();
  }
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch { toast('Kaydedilemedi: depolama dolu olabilir'); }
}

let state = load();
let today = C.todayKey();
let tab = 'today';
let historyFilter = 'all';
const scrollByTab = {};

const cats = () => state.settings.categories;
const catOf = (id) => cats().find((c) => c.id === id) || { id, name: 'Diğer', emoji: '📦' };

function runRollover() {
  if (!state.period) return;
  const { state: next, rolled } = C.rollover(state, today, uid);
  if (rolled) {
    state = { ...next, ui: { ...next.ui, newPeriod: true } };
    save();
  }
}

// ---------- Tarih gösterimi ----------
const dateOf = (key) => { const { y, m, d } = C.parseKey(key); return new Date(y, m - 1, d); };
const fmtLong = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
const fmtShort = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
function dayLabel(key) {
  if (key === today) return 'Bugün';
  if (key === C.addDays(today, -1)) return 'Dün';
  return fmtLong.format(dateOf(key));
}
const short = (key) => fmtShort.format(dateOf(key));

// ---------- Sayı animasyonu ----------
const lastVals = new Map();
function animateNumbers(root) {
  for (const el of $$('[data-num]', root)) {
    const key = el.dataset.num;
    const to = Number(el.dataset.val);
    const from = lastVals.has(key) ? lastVals.get(key) : to;
    lastVals.set(key, to);
    const opts = el.dataset.sign ? { sign: true } : undefined;
    if (from === to || reducedMotion()) { el.textContent = fmt(to, opts); continue; }
    const t0 = performance.now();
    const dur = 700;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e), opts);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
const num = (key, val, cls = '') => `<span class="num ${cls}" data-num="${key}" data-val="${val}">${fmt(val)}</span>`;

// ---------- Ortak parçalar ----------
function txRow(t) {
  const isInc = t.type === 'income';
  const c = isInc ? null : catOf(t.categoryId);
  const title = isInc ? (t.carry ? 'Devir' : (t.note || 'Gelir')) : c.name;
  const note = isInc ? (t.carry ? 'Önceki dönemden' : '') : t.note;
  const icon = isInc ? (t.carry ? '↪️' : '💰') : c.emoji;
  const amt = isInc ? fmt(t.amount, { sign: true }) : fmt(-t.amount);
  return `<div class="tx-wrap" data-id="${t.id}">
    <div class="tx-del" aria-hidden="true">Sil</div>
    <button class="tx" data-id="${t.id}">
      <span class="tx-icon ${isInc ? 'income' : ''}">${esc(icon)}</span>
      <span class="tx-main"><span class="tx-title">${esc(title)}</span>${note ? `<span class="tx-note">${esc(note)}</span>` : ''}</span>
      <span class="tx-amt num ${isInc ? 'income' : ''}">${amt}</span>
    </button>
  </div>`;
}

const sortTx = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0));

// ---------- Bugün ----------
function renderToday() {
  const s = C.dayStats(state.transactions, state.period, state.settings, today);
  const todays = state.transactions.filter((t) => t.date === today && t.type === 'expense').sort(sortTx);
  const pct = s.limit > 0 ? Math.min(1, s.spentToday / s.limit) : s.spentToday > 0 ? 1 : 0;
  const over = s.leftToday < 0;
  const R = 40, CIRC = 2 * Math.PI * R;
  const banner = state.ui.newPeriod
    ? `<div class="glass banner"><span style="font-size:24px">🎉</span><p><b>Yeni dönem başladı.</b> Bu dönemin gelirini ekleyerek başla.</p><button class="btn sm primary" data-act="add-income">Gelir ekle</button></div>`
    : '';
  const negNote = s.startBalance <= 0
    ? `<div class="tile banner"><p class="neg">Bakiyen bitti. Gelir ekleyene kadar limit hesaplanamıyor.</p></div>` : '';

  $('#view-today').innerHTML = `
    ${banner}
    <div class="glass hero">
      <div class="hero-top">
        <div style="flex:1;min-width:0">
          <div class="hero-label">Bugün kalan</div>
          <div class="hero-amount ${over ? 'neg' : ''}" style="--fit:${Math.min(1, 8 / fmt(s.leftToday).length).toFixed(2)}">${num('left', s.leftToday)}</div>
          <div class="hero-sub">Bugünün limiti <b>${num('limit', s.limit)}</b></div>
        </div>
        <div class="ring" role="img" aria-label="Limitin yüzde ${Math.round(pct * 100)}'i harcandı">
          <svg viewBox="0 0 92 92"><circle class="track" cx="46" cy="46" r="${R}"/>
            <circle class="val ${over ? 'over' : ''}" cx="46" cy="46" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}" data-offset="${CIRC * (1 - pct)}"/></svg>
          <div class="ring-label"><div>%${Math.round(s.limit > 0 ? (s.spentToday / s.limit) * 100 : pct * 100)}<small>harcandı</small></div></div>
        </div>
      </div>
      <div class="stats">
        <div class="tile stat"><div class="stat-label">Kalan bakiye</div><div class="stat-value ${s.balance < 0 ? 'neg' : ''}">${num('balance', s.balance)}</div></div>
        <div class="tile stat"><div class="stat-label">Kalan gün</div><div class="stat-value num">${s.daysLeft} gün</div></div>
        <div class="tile stat"><div class="stat-label">Bugün harcanan</div><div class="stat-value">${num('spent', s.spentToday)}</div></div>
        <div class="tile stat"><div class="stat-label">${s.isLastDay ? 'Dönem sonu' : 'Yarınki limit'}</div><div class="stat-value">${s.isLastDay ? `<span class="faint" style="font-size:15px">Son gün</span>` : num('tomorrow', s.tomorrowLimit)}</div></div>
      </div>
    </div>
    ${negNote}
    <h2 class="section-title">Bugünkü harcamalar</h2>
    <div class="glass list">${todays.length ? todays.map(txRow).join('') : `<div class="empty">Bugün henüz harcama yok.<br>Eklemek için <b>+</b> tuşuna dokun.</div>`}</div>`;

  requestAnimationFrame(() => {
    const ring = $('#view-today .ring .val');
    if (ring) ring.style.strokeDashoffset = ring.dataset.offset;
  });
}

// ---------- Hareketler ----------
function renderHistory() {
  const filters = [{ id: 'all', name: 'Tümü' }, { id: 'income', name: '💰 Gelir' }, ...cats().map((c) => ({ id: c.id, name: `${c.emoji} ${c.name}` }))];
  const list = state.transactions.filter((t) =>
    historyFilter === 'all' ? true : historyFilter === 'income' ? t.type === 'income' : t.type === 'expense' && t.categoryId === historyFilter,
  ).sort(sortTx);
  const groups = new Map();
  for (const t of list) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
  const body = [...groups.entries()].map(([day, items]) => {
    const spent = items.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
    return `<div class="tx-group"><div class="tx-day"><span>${esc(dayLabel(day))}</span><span class="num">${spent ? fmt(-spent) : ''}</span></div>${items.map(txRow).join('')}</div>`;
  }).join('');
  $('#view-history').innerHTML = `
    <div class="chips" role="group" aria-label="Filtre">${filters.map((f) => `<button class="chip" data-filter="${f.id}" aria-pressed="${f.id === historyFilter}">${esc(f.name)}</button>`).join('')}</div>
    <div class="glass list">${body || `<div class="empty">Bu dönemde kayıt yok.</div>`}</div>
    <p class="faint" style="font-size:13px;text-align:center;margin:0">Düzenlemek için dokun, silmek için sola kaydır.</p>`;
}

// ---------- Analiz ----------
function chartSvg(period) {
  const last = C.periodLastDay(period.start, state.settings);
  const series = C.periodSeries(state.transactions, period, state.settings, today);
  const n = C.diffDays(period.start, last) + 1;
  const W = 340, H = 170, top = 14, bottom = 20, ih = H - top - bottom;
  const max = Math.max(1, ...series.map((d) => Math.max(d.spent, d.limit))) * 1.1;
  const slot = W / n, bw = Math.max(2, slot * 0.62);
  const y = (v) => top + ih - (Math.max(0, v) / max) * ih;
  const bars = series.map((d, i) => {
    const h = top + ih - y(d.spent);
    return `<rect class="bar ${d.spent > d.limit ? 'over' : ''} ${d.day === today ? 'today' : ''}" x="${(i * slot + (slot - bw) / 2).toFixed(1)}" y="${y(d.spent).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="${Math.min(4, bw / 2).toFixed(1)}"><title>${short(d.day)}: ${fmt(d.spent)} / limit ${fmt(d.limit)}</title></rect>`;
  }).join('');
  const pts = series.flatMap((d, i) => [`${(i * slot).toFixed(1)},${y(d.limit).toFixed(1)}`, `${((i + 1) * slot).toFixed(1)},${y(d.limit).toFixed(1)}`]).join(' ');
  const step = Math.max(1, Math.ceil(n / 6));
  const labels = [];
  for (let i = 0; i < n; i += step) labels.push(`<text x="${(i * slot + slot / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${C.parseKey(C.addDays(period.start, i)).d}</text>`);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Günlük harcama ve limit grafiği">
    <line class="grid" x1="0" x2="${W}" y1="${top + ih}" y2="${top + ih}"/>
    <line class="grid" x1="0" x2="${W}" y1="${y(max / 1.1 / 2)}" y2="${y(max / 1.1 / 2)}"/>
    <text x="0" y="${top - 3}">${fmt(Math.round(max / 1.1), { symbol: false }).replace(/,\d+$/, '')} ₺</text>
    ${bars}<polyline class="limit" points="${pts}"/>${labels.join('')}</svg>`;
}

function catRows(rows, total) {
  if (!rows.length) return `<div class="empty">Henüz harcama yok.</div>`;
  return rows.map((r) => {
    const c = catOf(r.categoryId);
    return `<div class="cat-row"><span style="font-size:20px">${esc(c.emoji)}</span>
      <div><div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(c.name)}</span><span class="muted num" style="font-size:13px">%${Math.round(r.share * 100)}</span></div>
      <div class="cat-bar"><span style="width:${(r.share * 100).toFixed(1)}%"></span></div></div>
      <span class="num" style="font-weight:600">${fmt(r.amount)}</span></div>`;
  }).join('');
}

function renderAnalysis() {
  const p = state.period;
  const series = C.periodSeries(state.transactions, p, state.settings, today);
  const proj = C.projection(state.transactions, p, state.settings, today);
  const brk = C.categoryBreakdown(state.transactions.filter((t) => t.date <= today));
  const tops = C.topDays(series);
  const ok = proj.projectedEnd >= 0;
  const archive = state.archive.map((a) => `
    <details class="glass archive">
      <summary><span>${short(a.start)} – ${short(a.end)}</span><span class="num ${a.balance < 0 ? 'neg' : 'pos'}">${fmt(a.balance, { sign: true })}</span></summary>
      <div style="margin-top:10px">
        <div class="kv"><span class="muted">Gelir</span><span class="num">${fmt(a.income)}</span></div>
        <div class="kv"><span class="muted">Harcama</span><span class="num">${fmt(a.expense)}</span></div>
        <div class="kv"><span class="muted">Günlük ortalama</span><span class="num">${fmt(Math.round(a.expense / a.days))}</span></div>
        <div class="kv"><span class="muted">Süre</span><span class="num">${a.days} gün</span></div>
        <div style="margin-top:8px">${catRows(a.categories, a.expense)}</div>
      </div>
    </details>`).join('');

  $('#view-analysis').innerHTML = `
    <div class="glass card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
        <b>Günlük harcama</b><span class="muted" style="font-size:13px">${short(p.start)} – ${short(C.periodLastDay(p.start, state.settings))}</span>
      </div>
      ${chartSvg(p)}
      <div class="legend"><span><i style="background:var(--accent)"></i>Harcama</span><span><i style="background:var(--danger)"></i>Limit aşıldı</span><span><i style="background:none;border-top:2px dashed var(--text-2);height:0;border-radius:0"></i>Günün limiti</span></div>
    </div>
    <div class="glass card proj">
      <span class="muted">Bu hızla devam edersen dönem sonunda</span>
      <strong class="num ${ok ? 'pos' : 'neg'}">${fmt(Math.abs(proj.projectedEnd))} ${ok ? 'kalır' : 'eksik çıkar'}</strong>
      <span class="muted" style="font-size:13px">Günlük ortalama ${fmt(proj.avgDaily)} · ${proj.elapsed}/${proj.totalDays}. gün</span>
    </div>
    <h2 class="section-title">Kategoriler</h2>
    <div class="glass card" style="padding:8px 16px">${catRows(brk.rows, brk.total)}</div>
    <h2 class="section-title">En çok harcadığın günler</h2>
    <div class="glass card" style="padding:8px 16px">${tops.length ? tops.map((d, i) => `<div class="kv"><span>${['🥇', '🥈', '🥉'][i]} ${esc(dayLabel(d.day))}</span><span class="num ${d.spent > d.limit ? 'neg' : ''}">${fmt(d.spent)}</span></div>`).join('') : `<div class="empty">Henüz harcama yok.</div>`}</div>
    <h2 class="section-title">Geçmiş dönemler</h2>
    ${archive || `<div class="glass card empty">Dönem bittiğinde özeti burada görünecek.</div>`}`;
}

// ---------- Ayarlar ----------
function renderSettings() {
  const st = state.settings;
  const last = C.periodLastDay(state.period.start, st);
  const dayOpts = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${st.endDay === i + 1 ? 'selected' : ''}>Ayın ${i + 1}'${suffix(i + 1)}</option>`).join('');
  $('#view-settings').innerHTML = `
    <h2 class="section-title">Dönem</h2>
    <div class="glass group">
      <div class="setting"><div class="setting-text">Bitiş günü<small>Paranın yattığı gün. O ay yoksa ayın son günü.</small></div><select id="set-endday" aria-label="Bitiş günü">${dayOpts}</select></div>
      <label class="setting"><div class="setting-text">Bitiş günü döneme dahil<small>Kapalıysa para o gün yeniden yatar.</small></div><span class="switch"><input type="checkbox" id="set-incl" ${st.endInclusive ? 'checked' : ''}><span></span></span></label>
      <label class="setting"><div class="setting-text">Kalanı yeni döneme devret<small>Dönem sonundaki bakiye yeni döneme gelir olarak geçer.</small></div><span class="switch"><input type="checkbox" id="set-carry" ${st.carryOver ? 'checked' : ''}><span></span></span></label>
      <div class="setting"><div class="setting-text">Mevcut dönem<small class="num">${short(state.period.start)} – ${short(last)} · ${C.diffDays(state.period.start, last) + 1} gün</small></div></div>
    </div>
    <h2 class="section-title">Görünüm</h2>
    <div class="glass group"><div class="setting"><div class="setting-text">Tema</div>
      <div class="seg" role="group" aria-label="Tema">${[['system', 'Sistem'], ['light', 'Açık'], ['dark', 'Koyu']].map(([v, l]) => `<button data-theme-set="${v}" aria-pressed="${st.theme === v}">${l}</button>`).join('')}</div></div></div>
    <h2 class="section-title">Kategoriler</h2>
    <div class="glass group" id="cat-list">
      ${cats().map((c) => `<div class="cat-edit" data-cat="${c.id}">
        <input class="input emoji" value="${esc(c.emoji)}" maxlength="8" aria-label="${esc(c.name)} simgesi" data-field="emoji">
        <input class="input" value="${esc(c.name)}" maxlength="30" aria-label="Kategori adı" data-field="name">
        ${c.id === 'diger' ? '<span></span>' : `<button class="icon-btn" data-del-cat="${c.id}" aria-label="${esc(c.name)} kategorisini sil"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></svg></button>`}
      </div>`).join('')}
      <div style="padding:8px 16px 12px"><button class="btn sm block" data-act="add-cat">+ Kategori ekle</button></div>
    </div>
    <h2 class="section-title">Veriler</h2>
    <div class="glass group">
      <div class="setting"><div class="setting-text">Yedekle<small>Tüm veriler JSON dosyası olarak indirilir.</small></div><button class="btn sm" data-act="export">Dışa aktar</button></div>
      <div class="setting"><div class="setting-text">Geri yükle<small>Yedek dosyasındaki verilerle değiştirir.</small></div><button class="btn sm" data-act="import">İçe aktar</button></div>
      <div class="setting"><div class="setting-text">Tüm verileri sıfırla<small>Geri alınamaz.</small></div><button class="btn sm danger" data-act="reset">Sıfırla</button></div>
    </div>
    <div class="version">Bütçe v${VERSION} · Veriler yalnızca bu cihazda saklanır</div>`;
}
function suffix(n) {
  // Türkçe ünlü uyumu: 1'i, 2'si, 3'ü, 4'ü, 5'i, 6'sı, 7'si, 8'i, 9'u, 10'u ...
  const last = n % 10, tens = Math.floor(n / 10) % 10;
  if (last === 0) return ['', 'u', 'si', 'u'][tens] || 'u';
  return ['', 'i', 'si', 'ü', 'ü', 'i', 'sı', 'si', 'i', 'u'][last];
}

// ---------- Genel render ----------
function render() {
  if (!state.period) { showSetup(); return; }
  const last = C.periodLastDay(state.period.start, state.settings);
  $('#title').textContent = TITLES[tab];
  $('#subtitle').textContent = tab === 'today'
    ? fmtLong.format(dateOf(today))
    : `${short(state.period.start)} – ${short(last)}`;
  for (const v of $$('.view')) v.hidden = v.dataset.view !== tab;
  ({ today: renderToday, history: renderHistory, analysis: renderAnalysis, settings: renderSettings })[tab]();
  animateNumbers($(`#view-${tab}`));
  for (const b of $$('.tab')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  moveIndicator();
}

function moveIndicator() {
  const active = $(`.tab[data-tab="${tab}"]`);
  const ind = $('#tab-indicator');
  if (!active) return;
  ind.style.width = `${active.offsetWidth}px`;
  ind.style.transform = `translateX(${active.offsetLeft}px)`;
}

function setTab(next) {
  if (next === tab) { window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); return; }
  scrollByTab[tab] = window.scrollY;
  tab = next;
  buzz(6);
  render();
  window.scrollTo(0, scrollByTab[tab] || 0);
}

// ---------- Toast & diyalog ----------
let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn sm primary">${esc(action.label)}</button>` : ''}`;
  if (action) $('button', el).onclick = () => { action.run(); el.classList.remove('show'); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2200);
}

function confirmDialog({ title, text, ok = 'Onayla', danger = false }) {
  return new Promise((resolve) => {
    const bd = $('#dialog');
    bd.innerHTML = `<div class="glass dialog" role="alertdialog" aria-labelledby="dlg-t"><h3 id="dlg-t">${esc(title)}</h3><p>${esc(text)}</p>
      <div class="row"><button class="btn sm" data-r="0">Vazgeç</button><button class="btn sm ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`;
    bd.hidden = false;
    const done = (v) => { bd.hidden = true; bd.innerHTML = ''; resolve(v); };
    bd.onclick = (e) => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); else if (e.target === bd) done(false); };
    $('[data-r="1"]', bd).focus();
  });
}

// ---------- Hızlı giriş (bottom sheet) ----------
let draft = null;
let sheetPushed = false;

function openSheet(opts = {}) {
  const editing = opts.tx || null;
  draft = editing
    ? { type: editing.type, amountStr: C.amountToInput(editing.amount), categoryId: editing.categoryId || state.ui.lastCat, note: editing.note || '', date: editing.date, editingId: editing.id, carry: editing.carry }
    : { type: opts.type || 'expense', amountStr: '', categoryId: state.ui.lastCat, note: '', date: today, editingId: null };
  if (!cats().some((c) => c.id === draft.categoryId)) draft.categoryId = cats()[0]?.id;
  renderSheet();
  const sheet = $('#sheet');
  sheet.setAttribute('aria-hidden', 'false');
  sheet.style.transform = '';
  sheet.inert = false;
  sheet.classList.add('open');
  $('#sheet-backdrop').classList.add('open');
  // Klavyenin açılması için odak, dokunma olayının içinde senkron verilmeli
  const amt = $('#amt');
  amt.focus({ preventScroll: true });
  if (editing) amt.select();
  buzz(10);
  if (!sheetPushed) { history.pushState({ sheet: true }, ''); sheetPushed = true; }
}

function closeSheet(fromPop = false) {
  const sheet = $('#sheet');
  if (!sheet.classList.contains('open')) return;
  document.activeElement?.blur();
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  sheet.style.transform = '';
  $('#sheet-backdrop').classList.remove('open');
  draft = null;
  sheet.inert = true;
  if (fromPop) sheetPushed = false;
  else if (sheetPushed) { sheetPushed = false; history.back(); }
}

function renderSheet() {
  const d = draft;
  const isExp = d.type === 'expense';
  const yest = C.addDays(today, -1);
  const minDate = state.period.start;
  $('#sheet-body').innerHTML = `
    <div class="sheet-head">
      <h2 id="sheet-title">${d.editingId ? 'Kaydı düzenle' : 'Yeni kayıt'}</h2>
      ${d.carry ? '' : `<div class="seg" role="group" aria-label="Kayıt türü"><button data-type="expense" aria-pressed="${isExp}">Harcama</button><button data-type="income" aria-pressed="${!isExp}">Gelir</button></div>`}
    </div>
    <label class="amount-field"><input id="amt" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="0" value="${esc(d.amountStr)}" aria-label="Tutar"><span class="cur">₺</span></label>
    ${isExp ? `<div class="wrap-chips" role="group" aria-label="Kategori">${cats().map((c) => `<button class="chip" data-cat-pick="${c.id}" aria-pressed="${c.id === d.categoryId}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('')}</div>` : ''}
    <input class="input" id="note" maxlength="80" placeholder="${isExp ? 'Not (isteğe bağlı)' : 'Açıklama (ör. Burs)'}" value="${esc(d.note)}" enterkeyhint="done">
    <div class="date-row">
      <button class="chip" data-date="${today}" aria-pressed="${d.date === today}">Bugün</button>
      ${yest >= minDate ? `<button class="chip" data-date="${yest}" aria-pressed="${d.date === yest}">Dün</button>` : ''}
      <input class="input" type="date" id="date" min="${minDate}" max="${today}" value="${d.date}" aria-label="Tarih">
    </div>
    <div class="tile preview" id="preview" aria-live="polite"></div>
    <div class="sheet-actions ${d.editingId ? '' : 'single'}">
      ${d.editingId ? `<button class="btn danger" data-act="delete-draft">Sil</button>` : ''}
      <button class="btn primary block" id="save">${d.editingId ? 'Güncelle' : 'Kaydet'}</button>
    </div>`;
  updatePreview();
}

function draftTx() {
  const amount = C.parseAmount(draft.amountStr);
  return {
    type: draft.type, amount: amount ?? 0, date: draft.date,
    categoryId: draft.type === 'expense' ? draft.categoryId : null,
    note: draft.note.trim(), carry: draft.carry,
  };
}

function updatePreview() {
  const el = $('#preview');
  if (!el || !draft) return;
  const amount = C.parseAmount(draft.amountStr);
  const before = C.dayStats(state.transactions, state.period, state.settings, today);
  $('#save').disabled = !(amount > 0) && !draft.carry;
  if (draft.amountStr && amount === null) { el.innerHTML = `<span class="neg">Geçersiz tutar</span>`; return; }
  const after = C.preview(state.transactions, state.period, state.settings, today, amount ? draftTx() : null, draft.editingId);
  const word = draft.type === 'expense' ? 'harcamayla' : 'gelirle';
  const lines = [];
  if (!amount) {
    lines.push(before.isLastDay
      ? `Dönemin son günü. Kalan bakiye <b>${fmt(before.balance)}</b>`
      : `Şu an yarından itibaren günlük limitin <b>${fmt(before.tomorrowLimit)}</b>`);
  } else if (after.isLastDay) {
    lines.push(`Bu ${word} dönem sonunda <b class="${after.balance < 0 ? 'neg' : ''}">${fmt(after.balance)}</b> kalır`);
  } else {
    lines.push(`Bu ${word} yarından itibaren günlük limitin <b class="${after.tomorrowLimit < 0 ? 'neg' : ''}">${fmt(after.tomorrowLimit)}</b> olacak`);
  }
  if (amount && after.limit !== before.limit) lines.push(`<span class="muted">Bugünün limiti ${fmt(before.limit)} → <b>${fmt(after.limit)}</b></span>`);
  if (amount && after.leftToday !== before.leftToday) lines.push(`<span class="muted">Bugün kalan: <b class="${after.leftToday < 0 ? 'neg' : ''}">${fmt(after.leftToday)}</b></span>`);
  el.innerHTML = lines.join('<br>');
}

function saveDraft() {
  const amount = C.parseAmount(draft.amountStr);
  if (!(amount > 0) && !draft.carry) { buzz([20, 40, 20]); $('#amt').focus(); return; }
  if (draft.date < state.period.start || draft.date > today) { toast('Tarih bu dönemin içinde olmalı'); return; }
  const base = draftTx();
  if (draft.editingId) {
    state.transactions = state.transactions.map((t) => (t.id === draft.editingId ? { ...t, ...base, amount: amount ?? t.amount } : t));
  } else {
    state.transactions = [...state.transactions, { ...base, id: uid(), createdAt: Date.now() }];
  }
  if (draft.type === 'income') state.ui.newPeriod = false;
  if (draft.type === 'expense') state.ui.lastCat = draft.categoryId;
  const wasEdit = !!draft.editingId;
  save();
  closeSheet();
  render();
  buzz(15);
  toast(wasEdit ? 'Güncellendi' : 'Kaydedildi');
}

function deleteTx(id) {
  const idx = state.transactions.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const removed = state.transactions[idx];
  state.transactions = state.transactions.filter((t) => t.id !== id);
  save();
  render();
  buzz(12);
  toast('Kayıt silindi', {
    label: 'Geri al',
    run: () => { state.transactions = [...state.transactions, removed]; save(); render(); },
  });
}

// Sheet olayları
$('#sheet-body').addEventListener('input', (e) => {
  if (!draft) return;
  if (e.target.id === 'amt') { draft.amountStr = e.target.value; updatePreview(); }
  if (e.target.id === 'note') draft.note = e.target.value;
  if (e.target.id === 'date' && e.target.value) {
    draft.date = e.target.value;
    for (const b of $$('[data-date]')) b.setAttribute('aria-pressed', b.dataset.date === draft.date);
    updatePreview();
  }
});
$('#sheet-body').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target.id === 'amt' || e.target.id === 'note')) { e.preventDefault(); saveDraft(); }
});
$('#sheet-body').addEventListener('click', (e) => {
  if (!draft) return;
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.type) {
    draft.type = t.dataset.type;
    renderSheet();
    $('#amt').focus({ preventScroll: true });
    buzz(6);
  } else if (t.dataset.catPick) {
    draft.categoryId = t.dataset.catPick;
    for (const b of $$('[data-cat-pick]')) b.setAttribute('aria-pressed', b === t);
    buzz(6);
    updatePreview();
  } else if (t.dataset.date) {
    draft.date = t.dataset.date;
    $('#date').value = draft.date;
    for (const b of $$('[data-date]')) b.setAttribute('aria-pressed', b === t);
    updatePreview();
  } else if (t.id === 'save') {
    saveDraft();
  } else if (t.dataset.act === 'delete-draft') {
    const id = draft.editingId;
    closeSheet();
    deleteTx(id);
  }
});
$('#sheet-backdrop').addEventListener('click', () => closeSheet());
window.addEventListener('popstate', () => { if ($('#sheet').classList.contains('open')) closeSheet(true); sheetPushed = false; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// Sheet'i tutamaçtan aşağı sürükleyerek kapatma
(() => {
  const handle = $('#sheet-handle'), sheet = $('#sheet');
  let startY = null, dy = 0;
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; dy = 0; sheet.classList.add('dragging'); handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (startY === null) return;
    startY = null;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    if (dy > 110) closeSheet();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
})();

// ---------- Listede kaydırarak silme / dokunarak düzenleme ----------
(() => {
  let g = null;
  let suppressClick = false;
  document.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.tx');
    if (!row || e.button > 0) return;
    g = { row, wrap: row.parentElement, x: e.clientX, y: e.clientY, dx: 0, mode: null, id: e.pointerId };
  });
  document.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        g.mode = 'swipe';
        g.wrap.classList.add('swiping');
        try { g.row.setPointerCapture(e.pointerId); } catch {}
      } else if (Math.abs(dy) > 10) { g = null; return; }
    }
    if (g.mode === 'swipe') {
      g.dx = Math.min(0, dx);
      g.row.style.transform = `translateX(${g.dx}px)`;
    }
  });
  const end = () => {
    if (!g) return;
    const { row, wrap, dx, mode } = g;
    g = null;
    if (mode !== 'swipe') return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 50);
    wrap.classList.remove('swiping');
    if (dx < -Math.min(120, wrap.offsetWidth * 0.33)) {
      row.style.transform = `translateX(-110%)`;
      setTimeout(() => deleteTx(row.dataset.id), 180);
    } else {
      row.style.transform = '';
    }
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.tx');
    if (!row) return;
    if (suppressClick) { e.preventDefault(); return; }
    const tx = state.transactions.find((t) => t.id === row.dataset.id);
    if (tx?.carry) toast('Devir kaydı düzenlenemez; sola kaydırıp silebilirsin');
    else if (tx) openSheet({ tx });
  });
})();

// ---------- Genel tıklamalar ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.matches('.tab')) return setTab(t.dataset.tab);
  if (t.id === 'fab') return openSheet();
  if (t.dataset.filter) { historyFilter = t.dataset.filter; renderHistory(); return; }
  if (t.dataset.themeSet) { state.settings.theme = t.dataset.themeSet; save(); applyTheme(); renderSettings(); return; }
  if (t.dataset.delCat) {
    const c = catOf(t.dataset.delCat);
    const ok = await confirmDialog({ title: `“${c.name}” silinsin mi?`, text: 'Bu kategorideki harcamalar “Diğer” kategorisine taşınır.', ok: 'Sil', danger: true });
    if (!ok) return;
    state.settings.categories = cats().filter((x) => x.id !== c.id);
    state.transactions = state.transactions.map((x) => (x.categoryId === c.id ? { ...x, categoryId: 'diger' } : x));
    if (state.ui.lastCat === c.id) state.ui.lastCat = 'diger';
    save(); renderSettings();
    return;
  }
  switch (t.dataset.act) {
    case 'add-income': return openSheet({ type: 'income' });
    case 'add-cat': {
      state.settings.categories = [...cats().filter((c) => c.id !== 'diger'), { id: uid(), name: 'Yeni kategori', emoji: '🏷️' }, ...cats().filter((c) => c.id === 'diger')];
      save(); renderSettings();
      const inputs = $$('#cat-list [data-field="name"]');
      const input = inputs[inputs.length - 2] || inputs[0];
      input?.focus(); input?.select();
      return;
    }
    case 'export': return exportData();
    case 'import': return importData();
    case 'reset': {
      const ok = await confirmDialog({ title: 'Tüm veriler silinsin mi?', text: 'Bütün dönemler, gelirler ve harcamalar kalıcı olarak silinir. Önce yedek almak isteyebilirsin.', ok: 'Her şeyi sil', danger: true });
      if (!ok) return;
      localStorage.removeItem(STORE_KEY);
      state = freshState();
      lastVals.clear();
      tab = 'today';
      render();
      return;
    }
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'set-endday') { state.settings.endDay = Number(el.value); afterPeriodSettingChange(); }
  else if (el.id === 'set-incl') { state.settings.endInclusive = el.checked; afterPeriodSettingChange(); }
  else if (el.id === 'set-carry') { state.settings.carryOver = el.checked; save(); }
  else if (el.dataset.field) {
    const id = el.closest('[data-cat]').dataset.cat;
    const value = el.value.trim() || (el.dataset.field === 'name' ? 'Adsız' : '🏷️');
    state.settings.categories = cats().map((c) => (c.id === id ? { ...c, [el.dataset.field]: value } : c));
    save();
  }
});

function afterPeriodSettingChange() {
  const before = state.archive.length;
  runRollover();
  save();
  render();
  if (state.archive.length > before) toast('Dönem bitiş tarihi geçtiği için arşivlendi');
  else toast('Dönem güncellendi');
}

// ---------- Dışa / içe aktarma ----------
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'butce-takip', exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `butce-yedek-${today}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Yedek indirildi');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.settings || !Array.isArray(data.transactions) || !Array.isArray(data.archive) || !data.period?.start) throw new Error();
      const ok = await confirmDialog({ title: 'Yedek geri yüklensin mi?', text: `${data.transactions.length} kayıt ve ${data.archive.length} geçmiş dönem yüklenecek. Mevcut verilerin yerine geçer.`, ok: 'Geri yükle' });
      if (!ok) return;
      const f = freshState();
      state = { ...f, settings: { ...f.settings, ...data.settings }, period: data.period, transactions: data.transactions, archive: data.archive, ui: { ...f.ui, ...data.ui } };
      $('#setup').hidden = true;
      document.body.classList.remove('setup-mode');
      runRollover();
      save();
      applyTheme();
      lastVals.clear();
      render();
      toast('Yedek geri yüklendi');
    } catch {
      toast('Dosya okunamadı: geçerli bir yedek değil');
    }
  };
  input.click();
}

// ---------- İlk kurulum ----------
function showSetup() {
  const el = $('#setup');
  const st = state.settings;
  el.hidden = false;
  document.body.classList.add('setup-mode');
  el.innerHTML = `<div class="glass card">
    <h2>Hoş geldin 👋</h2>
    <p>Bakiyeni bir sonraki para yatışına kadar günlere bölelim. Her gün ne kadar harcayabileceğini görürsün.</p>
    <label class="field"><span>Şu anki bakiyen</span>
      <span class="amount-field" style="padding:0"><input id="s-bal" class="input big" inputmode="decimal" placeholder="0" autocomplete="off"><span class="cur">₺</span></span></label>
    <label class="field"><span>Para ayın kaçında yatıyor?</span>
      <select id="s-day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${st.endDay === i + 1 ? 'selected' : ''}>Ayın ${i + 1}'${suffix(i + 1)}</option>`).join('')}</select></label>
    <label class="tile setting"><div class="setting-text">Bitiş günü döneme dahil<small>Kapalıysa para o gün yeniden yatar.</small></div><span class="switch"><input type="checkbox" id="s-incl" ${st.endInclusive ? 'checked' : ''}><span></span></span></label>
    <div class="tile preview" id="s-prev"></div>
    <button class="btn primary block" id="s-go">Başla</button>
    <button class="btn block" id="s-import">Yedekten geri yükle</button>
  </div>`;
  const upd = () => {
    const s = { ...st, endDay: Number($('#s-day').value), endInclusive: $('#s-incl').checked };
    const last = C.periodLastDay(today, s);
    const days = C.diffDays(today, last) + 1;
    const bal = C.parseAmount($('#s-bal').value) || 0;
    $('#s-prev').innerHTML = `Dönem: <b>bugün – ${short(last)}</b> · ${days} gün${bal ? `<br>Bugünün limiti <b>${fmt(Math.trunc(bal / days))}</b>` : ''}`;
  };
  el.oninput = upd;
  el.onchange = upd;
  upd();
  $('#s-import').onclick = importData;
  $('#s-go').onclick = () => {
    const bal = C.parseAmount($('#s-bal').value);
    if (bal === null) { $('#s-bal').focus(); buzz([20, 40, 20]); return; }
    state.settings.endDay = Number($('#s-day').value);
    state.settings.endInclusive = $('#s-incl').checked;
    state.period = { id: uid(), start: today };
    state.transactions = bal > 0 ? [{ id: uid(), type: 'income', amount: bal, categoryId: null, note: 'Başlangıç bakiyesi', date: today, createdAt: Date.now() }] : [];
    save();
    el.hidden = true;
    el.innerHTML = '';
    document.body.classList.remove('setup-mode');
    buzz(15);
    render();
  };
}

// ---------- Tema ----------
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const m of $$('meta[name="theme-color"]')) m.setAttribute('content', dark ? '#070912' : '#eef1f8');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- Kaydırınca küçülen menü ----------
(() => {
  let lastY = window.scrollY;
  const bar = $('#tabbar');
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > lastY + 6 && y > 40) bar.classList.add('compact');
    else if (y < lastY - 6 || y < 20) bar.classList.remove('compact');
    lastY = y;
  }, { passive: true });
})();

// ---------- Cam kırılma haritası (SVG displacement) ----------
// Kapsülün kenar bandında pikselleri içe doğru iten bir harita üretir;
// backdrop-filter: url(#lg-refract) ile arka plan kenarlarda mercek gibi bükülür.
function buildRefractionMap() {
  const el = $('#tabbar-glass');
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (!w || !h) return;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const r = h / 2, band = Math.min(22, r);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      const cx = Math.min(Math.max(px, r), w - r);
      const vx = px - cx, vy = py - r;
      const dist = Math.hypot(vx, vy);
      const edge = r - dist;
      let dx = 0, dy = 0;
      if (dist > 0 && edge >= 0 && edge < band) {
        const s = Math.pow(1 - edge / band, 2);
        dx = (-vx / dist) * s; dy = (-vy / dist) * s;
      }
      const i = (y * w + x) * 4;
      img.data[i] = 128 + dx * 127;
      img.data[i + 1] = 128 + dy * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  const fe = $('#lg-map');
  fe.setAttribute('href', url);
  fe.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
  fe.setAttribute('width', w);
  fe.setAttribute('height', h);
}
function setupRefraction() {
  const chromium = navigator.userAgentData?.brands?.some((b) => b.brand === 'Chromium');
  const lessTransparency = matchMedia('(prefers-reduced-transparency: reduce)').matches;
  if (!chromium || lessTransparency) return;
  buildRefractionMap();
  document.documentElement.classList.add('refract');
}

// ---------- Gün değişimi ----------
function checkDay() {
  const k = C.todayKey();
  if (k === today) return;
  today = k;
  runRollover();
  if (draft) updatePreview();
  render();
}
function scheduleMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  setTimeout(() => { checkDay(); scheduleMidnight(); }, next - now);
}
setInterval(checkDay, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
window.addEventListener('focus', checkDay);
window.addEventListener('pageshow', checkDay);

// ---------- Başlat ----------
let resizeTimer;
window.addEventListener('resize', () => {
  moveIndicator();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (document.documentElement.classList.contains('refract')) buildRefractionMap(); }, 200);
});

applyTheme();
runRollover();
render();
requestAnimationFrame(() => { moveIndicator(); setupRefraction(); });
scheduleMidnight();
if (state.period && new URLSearchParams(location.search).has('add')) {
  history.replaceState(null, '', location.pathname);
  openSheet();
}
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Test/hata ayıklama için
window.__butce = { C, get state() { return state; }, checkDay };
