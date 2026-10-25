// Saf hesaplama fonksiyonları — DOM'a, saate ya da depolamaya dokunmaz.
// Tutarlar her yerde KURUŞ cinsinden tam sayıdır. Tarihler 'YYYY-MM-DD' dizgileridir
// (cihazın yerel takvim günü); gün aritmetiği UTC üzerinden yapılır, böylece
// saat dilimi / yaz saati kayması olmaz.

const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');

export function toKey(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

/** Cihazın yerel saatine göre bugünün anahtarı (UTC değil). */
export function todayKey(now = new Date()) {
  return toKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const toUtc = (key) => {
  const { y, m, d } = parseKey(key);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms) => {
  const dt = new Date(ms);
  return toKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

export function addDays(key, n) {
  return fromUtc(toUtc(key) + n * DAY_MS);
}

/** b − a, gün olarak. */
export function diffDays(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Başlangıçtan SONRAKİ ilk "bitiş günü". O ay o gün yoksa ayın son günü. */
export function boundaryAfter(startKey, endDay) {
  const { y, m, d } = parseKey(startKey);
  const thisMonth = Math.min(endDay, daysInMonth(y, m));
  if (thisMonth > d) return toKey(y, m, thisMonth);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return toKey(ny, nm, Math.min(endDay, daysInMonth(ny, nm)));
}

/** Dönemin bütçeye dahil son günü. */
export function periodLastDay(startKey, settings) {
  const b = boundaryAfter(startKey, settings.endDay);
  return settings.endInclusive ? b : addDays(b, -1);
}

const isIncome = (t) => t.type === 'income';
const isExpense = (t) => t.type === 'expense';

function sum(txs, pred) {
  let s = 0;
  for (const t of txs) if (pred(t)) s += t.amount;
  return s;
}

/**
 * Bir günün durumu.
 *  limit      = (o güne kadarki gelir − o günden ÖNCEKİ harcamalar) / (o gün dahil kalan gün)
 *  leftToday  = limit − o günün harcamaları  (eksi olabilir)
 * Gün içindeki harcamalar limiti değiştirmez; ertesi gün formül fazlayı/eksiği
 * kalan günlere kendiliğinden eşit dağıtır.
 */
export function dayStats(txs, period, settings, day) {
  const last = periodLastDay(period.start, settings);
  const daysLeft = Math.max(1, diffDays(day, last) + 1);
  const income = sum(txs, (t) => isIncome(t) && t.date <= day);
  const spentBefore = sum(txs, (t) => isExpense(t) && t.date < day);
  const spentToday = sum(txs, (t) => isExpense(t) && t.date === day);
  const startBalance = income - spentBefore;
  const limit = Math.trunc(startBalance / daysLeft);
  const balance = startBalance - spentToday;
  const isLastDay = day >= last;
  const tomorrowLimit = isLastDay ? null : Math.trunc(balance / (daysLeft - 1));
  return {
    day, last, daysLeft, income, spentBefore, spentToday,
    startBalance, limit, leftToday: limit - spentToday, balance,
    isLastDay, tomorrowLimit,
  };
}

/** Taslak kayıt eklenmiş/düzenlenmiş haliyle işlem listesi (önizleme için). */
export function applyDraft(txs, draft, editingId = null) {
  const rest = editingId ? txs.filter((t) => t.id !== editingId) : txs.slice();
  if (draft && draft.amount > 0) rest.push({ ...draft, id: editingId || '__draft__' });
  return rest;
}

/** Kaydetmeden önce: bu kayıtla bugün ve yarından itibaren durum ne olur? */
export function preview(txs, period, settings, day, draft, editingId = null) {
  const next = applyDraft(txs, draft, editingId);
  return dayStats(next, period, settings, day);
}

/** Dönem başından `upTo` gününe kadar her gün: harcama ve o günün limiti. */
export function periodSeries(txs, period, settings, upTo) {
  const last = periodLastDay(period.start, settings);
  const end = upTo < last ? upTo : last;
  const out = [];
  for (let d = period.start; d <= end; d = addDays(d, 1)) {
    const s = dayStats(txs, period, settings, d);
    out.push({ day: d, spent: s.spentToday, limit: s.limit });
  }
  return out;
}

export function categoryBreakdown(txs) {
  const map = new Map();
  let total = 0;
  for (const t of txs) {
    if (!isExpense(t)) continue;
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
    total += t.amount;
  }
  const rows = [...map.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount, share: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { total, rows };
}

export function topDays(series, n = 3) {
  return series.filter((d) => d.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, n);
}

/** "Bu hızla devam edersen dönem sonunda X kalır / eksik çıkar." */
export function projection(txs, period, settings, today) {
  const last = periodLastDay(period.start, settings);
  const totalDays = diffDays(period.start, last) + 1;
  const elapsed = Math.min(totalDays, Math.max(1, diffDays(period.start, today) + 1));
  const income = sum(txs, (t) => isIncome(t) && t.date <= today);
  const spent = sum(txs, (t) => isExpense(t) && t.date <= today);
  const avgDaily = Math.round(spent / elapsed);
  const projectedEnd = income - Math.round((spent / elapsed) * totalDays);
  return { totalDays, elapsed, avgDaily, projectedEnd };
}

export function summarize(txs, period, settings) {
  const last = periodLastDay(period.start, settings);
  const income = sum(txs, isIncome);
  const expense = sum(txs, isExpense);
  return {
    start: period.start, end: last,
    days: diffDays(period.start, last) + 1,
    income, expense, balance: income - expense,
    categories: categoryBreakdown(txs).rows,
  };
}

/**
 * Bugün dönemin son gününü geçtiyse dönemi arşivler ve yeni dönemi açar
 * (gerekirse art arda birkaç kez). Yeni bir state döndürür; girdiyi değiştirmez.
 */
export function rollover(state, today, makeId) {
  let s = state;
  let rolled = false;
  while (s.period && today > periodLastDay(s.period.start, s.settings)) {
    const last = periodLastDay(s.period.start, s.settings);
    const inPeriod = s.transactions.filter((t) => t.date <= last);
    const later = s.transactions.filter((t) => t.date > last);
    const summary = summarize(inPeriod, s.period, s.settings);
    const nextStart = addDays(last, 1);
    const carried = [];
    if (s.settings.carryOver && summary.balance !== 0) {
      carried.push({
        id: makeId(), type: 'income', carry: true, amount: summary.balance,
        categoryId: null, note: 'Önceki dönemden devir', date: nextStart, createdAt: Date.now(),
      });
    }
    s = {
      ...s,
      archive: [{ id: s.period.id, ...summary, transactions: inPeriod }, ...s.archive],
      period: { id: makeId(), start: nextStart },
      transactions: [...carried, ...later],
    };
    rolled = true;
  }
  return { state: s, rolled };
}

// ---- Biçimlendirme ve ayrıştırma ----

/** 104444 → "1.044,44 ₺" (tr-TR). */
export function formatTL(kurus, { sign = false, symbol = true } = {}) {
  const neg = kurus < 0;
  const abs = Math.abs(Math.trunc(kurus));
  const lira = Math.floor(abs / 100);
  const frac = pad(abs % 100);
  const grouped = String(lira).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const prefix = neg ? '−' : sign && kurus > 0 ? '+' : '';
  return `${prefix}${grouped},${frac}${symbol ? ' ₺' : ''}`;
}

/**
 * Kullanıcı girdisini kuruşa çevirir, kayan nokta kullanmadan.
 * "12,5" "12.50" "1.234,56" "1234" kabul edilir. Geçersizse null.
 */
export function parseAmount(input) {
  let s = String(input).trim().replace(/[\s₺]/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    const parts = s.split('.');
    // "1.234" → binlik ayırıcı; "12.5" / "12.50" → ondalık
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = parts.join('');
  }
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  const v = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return Number.isSafeInteger(v) ? v : null;
}

/** Kuruşu düzenleme alanına yazılacak hale getirir: 104444 → "1044,44" */
export function amountToInput(kurus) {
  const lira = Math.floor(kurus / 100);
  const frac = kurus % 100;
  return frac ? `${lira},${pad(frac)}` : String(lira);
}
