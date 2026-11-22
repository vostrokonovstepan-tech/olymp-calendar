import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readCalendar, tomorrowInMoscow, reminders, messages, sendTelegram } from './remind.mjs';

const target = '2026-11-18';
const olympiad = stages => ({ name: 'Тест', subject: 'Физика', stages });

test('Moscow calendar date: UTC boundary, month and year changes', () => {
  assert.equal(tomorrowInMoscow(new Date('2026-11-17T20:59:59Z')), '2026-11-18');
  assert.equal(tomorrowInMoscow(new Date('2026-11-17T21:00:00Z')), '2026-11-19');
  assert.equal(tomorrowInMoscow(new Date('2026-12-31T04:00:00Z')), '2027-01-01');
  assert.equal(tomorrowInMoscow(new Date('2028-02-28T04:00:00Z')), '2028-02-29');
});

test('start and end notifications; single-day event appears once', () => {
  const items = reminders([olympiad([
    { type: 'Отбор', date: target, end: '2026-11-25', time: '10:00' },
    { type: 'Регистрация', date: '2026-11-01', end: target },
    { type: 'Финал', date: target, end: target, time: '14:00' },
    { type: 'Позже', date: '2026-11-19' },
  ])], target);
  assert.equal(items.length, 3);
  assert.match(items[0], /начинается.*\nОтбор, 10:00 МСК/);
  assert.match(items[1], /заканчивается/);
  assert.match(items[2], /состоится.*\nФинал, 14:00 МСК/);
});

test('completed registrations, preparation, repeating lessons and unknown dates are skipped', () => {
  assert.deepEqual(reminders([
    olympiad([{ type: 'Регистрация', end: target, done: true }, { type: 'Финал', date: '' }]),
    { ...olympiad([{ date: target }]), kind: 'prep' },
    olympiad([{ date: target, rep: 'w' }]),
  ], target), []);
});

test('unknown start still permits an end reminder; plain text preserves names', () => {
  const items = reminders([{ name: '<МГУ> & физика', stages: [{ type: 'Отбор', end: target }] }], target);
  assert.equal(items.length, 1);
  assert.match(items[0], /заканчивается: <МГУ> & физика/);
});

test('no empty messages and batches stay within Telegram limits', () => {
  assert.deepEqual(messages([], target), []);
  const batches = messages(Array.from({ length: 30 }, () => 'я'.repeat(500)), target);
  assert(batches.length > 1);
  assert(batches.every(text => text.length <= 3500));
});

test('repository calendar is read directly, with existing done flags', async () => {
  const calendar = JSON.parse(await readCalendar());
  assert(calendar.find(o => o.id === 'bibn_rus').stages[0].done);
  assert(calendar.find(o => o.id === 'ingeneer_phys').stages[0].done);
  assert(calendar.find(o => o.id === 'lomo_mechanics').stages[0].done);
  const economy = calendar.find(o => o.id === 'vp_eco');
  assert(economy.stages.find(s => s.type === 'Отборочный этап').done);
  assert(!reminders(calendar, '2026-11-21').some(s => /Высшая проба.*Экономика/.test(s)));
  assert(!reminders(calendar, '2026-11-27').some(s => /Би-Бн.*Русский язык.*\nРегистрация/.test(s)));
});

test('test message is available without a calendar event and dry-run never sends', () => {
  const text = execFileSync(process.execPath, [new URL('./remind.mjs', import.meta.url).pathname, '--test', '--dry-run'], {
    encoding: 'utf8', env: { ...process.env, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' },
  });
  assert.match(text, /Пробное уведомление/);
  assert.match(text, /07:00 МСК/);
});

test('Telegram delivery: private payload, no formatting mode, success checked', async () => {
  await sendTelegram('Завтра финал', { token: 'test-token', chatId: '123', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.telegram.org/bottest-token/sendMessage');
    const payload = JSON.parse(options.body);
    assert.equal(payload.chat_id, '123');
    assert.equal(payload.text, 'Завтра финал');
    assert.equal(payload.parse_mode, undefined);
    return { ok: true, json: async () => ({ ok: true }) };
  } });
});

test('failures do not leak token or chat ID, and missing secrets stop delivery', async () => {
  await assert.rejects(sendTelegram('test', { token: '', chatId: '' }), /TELEGRAM_BOT_TOKEN/);
  await assert.rejects(sendTelegram('test', { token: 'sensitive', chatId: '123', fetchImpl: async () => {
    throw new Error('https://api.telegram.org/botsensitive/sendMessage');
  } }), error => !error.message.includes('sensitive'));
  await assert.rejects(sendTelegram('test', { token: 'sensitive', chatId: '123', fetchImpl: async () => ({
    ok: false, status: 403, json: async () => ({ ok: false, description: 'sensitive' }),
  }) }), error => /403/.test(error.message) && !error.message.includes('sensitive'));
});
