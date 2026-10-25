// Çalıştırma:  TZ=Europe/Istanbul node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../calc.js';

const settings = { endDay: 15, endInclusive: false, carryOver: true };
const exp = (date, amount, categoryId = 'yemek') => ({ id: Math.random().toString(36), type: 'expense', amount, categoryId, date });
const inc = (date, amount) => ({ id: Math.random().toString(36), type: 'income', amount, date });

// Bugün 2026-11-05, son gün 2026-11-14 (bitiş günü 15, dahil değil) → bugün dahil 10 gün.
const period = { id: 'p', start: '2026-10-15' };
const today = '2026-11-05';
const base = [inc('2026-10-15', 1_000_000)]; // 10.000 ₺, önceki harcama yok

test('1) 10.000 ₺, 10 gün → bugünün limiti 1.000 ₺', () => {
  const s = C.dayStats(base, period, settings, today);
  assert.equal(s.daysLeft, 10);
  assert.equal(s.limit, 100_000);
  assert.equal(C.formatTL(s.limit), '1.000,00 ₺');
});

test('2) bugün 600 ₺ → bugün kalan 400 ₺, yarın 1.044,44 ₺', () => {
  const txs = [...base, exp(today, 60_000)];
  const s = C.dayStats(txs, period, settings, today);
  assert.equal(s.limit, 100_000, 'gün içi harcama limiti değiştirmez');
  assert.equal(s.leftToday, 40_000);
  const t = C.dayStats(txs, period, settings, C.addDays(today, 1));
  assert.equal(t.daysLeft, 9);
  assert.equal(C.formatTL(t.limit), '1.044,44 ₺');
  assert.equal(s.tomorrowLimit, t.limit, 'önizleme ile ertesi gün hesabı aynı');
});

test('3) bugün 1.600 ₺ → bugün kalan −600 ₺, yarın 933,33 ₺', () => {
  const txs = [...base, exp(today, 160_000)];
  const s = C.dayStats(txs, period, settings, today);
  assert.equal(s.leftToday, -60_000);
  assert.equal(C.formatTL(s.leftToday), '−600,00 ₺');
  const t = C.dayStats(txs, period, settings, C.addDays(today, 1));
  assert.equal(C.formatTL(t.limit), '933,33 ₺');
});

test('4) dönemin son günü → limit = kalan bakiyenin tamamı', () => {
  const txs = [...base, exp('2026-11-01', 123_456)];
  const s = C.dayStats(txs, period, settings, '2026-11-14');
  assert.equal(s.daysLeft, 1);
  assert.equal(s.isLastDay, true);
  assert.equal(s.limit, 1_000_000 - 123_456);
});

test('5) bitiş günü 31, ay 30 çekiyor → dönem 30’unda biter', () => {
  assert.equal(C.boundaryAfter('2026-11-01', 31), '2026-11-30');
  assert.equal(C.periodLastDay('2026-11-01', { endDay: 31, endInclusive: true }), '2026-11-30');
  assert.equal(C.periodLastDay('2026-11-01', { endDay: 31, endInclusive: false }), '2026-11-29');
  assert.equal(C.boundaryAfter('2027-02-01', 31), '2027-02-28');
  assert.equal(C.boundaryAfter('2028-02-01', 30), '2028-02-29'); // artık yıl
  assert.equal(C.boundaryAfter('2026-12-20', 15), '2027-01-15'); // yıl geçişi
});

test('6) gün değişimi yerel saate göre (Europe/Istanbul), UTC kayması yok', () => {
  // Bu test TZ=Europe/Istanbul ile çalıştırılmalı (npm test bunu ayarlar).
  const before = new Date(2026, 10, 5, 23, 59, 59);
  const after = new Date(2026, 10, 6, 0, 0, 0);
  assert.equal(C.todayKey(before), '2026-11-05');
  assert.equal(C.todayKey(after), '2026-11-06');
  // UTC'de 21:00 = İstanbul'da gece yarısı. toISOString kullansaydık gün hâlâ 5 olurdu.
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/Istanbul') {
    assert.equal(after.toISOString().slice(0, 10), '2026-11-05');
  }
  const txs = [...base, exp('2026-11-05', 60_000)];
  assert.equal(C.dayStats(txs, period, settings, C.todayKey(before)).limit, 100_000);
  assert.equal(C.dayStats(txs, period, settings, C.todayKey(after)).limit, 104_444);
});

test('dönem ortası gelir kalan günlere eşit dağılır', () => {
  const txs = [...base, inc(today, 90_000)];
  assert.equal(C.dayStats(txs, period, settings, today).limit, 109_000);
});

test('geçmiş tarihli harcama, düzenleme ve silme tutarlı', () => {
  const e = exp('2026-11-02', 50_000);
  const txs = [...base, e];
  assert.equal(C.dayStats(txs, period, settings, today).limit, 95_000);
  const edited = C.applyDraft(txs, { ...e, amount: 20_000 }, e.id);
  assert.equal(C.dayStats(edited, period, settings, today).limit, 98_000);
  const removed = txs.filter((t) => t.id !== e.id);
  assert.equal(C.dayStats(removed, period, settings, today).limit, 100_000);
});

test('önizleme: taslak harcama yarının limitini gösterir', () => {
  const p = C.preview(base, period, settings, today, { type: 'expense', amount: 60_000, date: today });
  assert.equal(p.tomorrowLimit, 104_444);
  assert.equal(p.leftToday, 40_000);
});

test('dönem bitince arşivlenir, devir yeni döneme geçer', () => {
  const st = { settings, period, transactions: [...base, exp('2026-11-10', 400_000)], archive: [] };
  let n = 0;
  const { state, rolled } = C.rollover(st, '2026-11-15', () => `id${n++}`);
  assert.equal(rolled, true);
  assert.equal(state.period.start, '2026-11-15');
  assert.equal(state.archive.length, 1);
  assert.equal(state.archive[0].balance, 600_000);
  assert.equal(state.transactions.length, 1);
  assert.equal(state.transactions[0].amount, 600_000);
  assert.equal(C.periodLastDay(state.period.start, settings), '2026-12-14');
});

test('tutar ayrıştırma kuruşa tam sayı', () => {
  assert.equal(C.parseAmount('12,5'), 1250);
  assert.equal(C.parseAmount('12.50'), 1250);
  assert.equal(C.parseAmount('1.234,56'), 123456);
  assert.equal(C.parseAmount('1.234'), 123400);
  assert.equal(C.parseAmount('0,1'), 10);
  assert.equal(C.parseAmount('abc'), null);
  assert.equal(C.parseAmount('1,234'), null);
  assert.equal(C.formatTL(123456789), '1.234.567,89 ₺');
});
