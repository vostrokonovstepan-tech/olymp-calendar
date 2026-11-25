import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function app() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\nload\(\);\s*$/, '');
  const node = { addEventListener() {} };
  const context = createContext({
    window: {}, document: { getElementById: () => node, querySelector: () => node },
    TextEncoder, TextDecoder, crypto: webcrypto,
  });
  new Script(source + '\nthis.api={isWaiting,mergeSeed,normalize,renderWaiting,SEED,setRecords:records=>{olys=records}};').runInContext(context);
  return context.api;
}

test('waiting list contains written stages with unknown results, including unknown dates', () => {
  const api = app();
  api.setRecords(api.SEED);
  const html = api.renderWaiting();
  for (const id of ['ranepa_eco', 'shvb_math', 'phystech_eng', 'vp_eng', 'lomo_mechanics']) assert(html.includes(`data-open="${id}"`));
  for (const id of ['mosh_phys', 'nto', 'mosh_eco']) assert(!html.includes(`data-open="${id}"`));
  assert(api.isWaiting({ type: 'Отборочный этап', done: true, date: '' }));
  assert(!api.isWaiting({ type: 'Регистрация', done: true }));
  assert(!api.isWaiting({ type: 'Отборочный этап', done: false }));
  assert(!api.isWaiting({ type: 'Отборочный этап', done: true, resultKnown: true }));
});

test('received result survives an update and import; user credentials and stages stay intact', () => {
  const api = app();
  const seed = api.SEED.find(o => o.id === 'mosh_eco');
  const custom = { type: 'Другое', name: 'Личная заметка', u: true };
  const merged = api.mergeSeed({ ...seed, cred: { iv: 'saved', ct: 'encrypted' }, stages: [
    ...seed.stages.map(s => ({ ...s, done: true, resultKnown: true })), custom,
  ] }, seed);
  assert.equal(merged.cred.ct, 'encrypted');
  assert(merged.stages.some(s => s.u && s.name === custom.name));
  const stage = merged.stages.find(s => s.type === 'Отборочный этап');
  assert.equal(stage.date, '2026-12-08');
  assert.equal(stage.end, '2026-12-14');
  assert.equal(stage.done, true);
  assert.equal(stage.resultKnown, true);
  assert(api.normalize(merged).stages.find(s => s.type === 'Отборочный этап').resultKnown);
  api.setRecords([merged]);
  assert(api.renderWaiting().includes('Пока ничего не ждём'));
});

test('written mechanics selection waits for results and keeps its dates and registration', () => {
  const api = app();
  const mechanics = api.SEED.find(o => o.id === 'lomo_mechanics');
  assert(mechanics.stages.find(s => s.type === 'Регистрация').done);
  const stage = mechanics.stages.find(s => s.type === 'Отборочный этап');
  assert.equal(stage.date, '2026-11-20');
  assert.equal(stage.end, '2026-11-27');
  assert(api.isWaiting(stage));
});

test('incorrect energy registrations reset once; later user registration survives updates', () => {
  const api = app();
  for (const [id, oldVersion] of [['hope_math', 1], ['hope_phys', 2]]) {
    const seed = api.SEED.find(o => o.id === id);
    const previous = { ...seed, cred: { iv: 'saved', ct: 'encrypted' }, stages: seed.stages.map(s => ({ ...s, done: true })) };
    const corrected = api.mergeSeed(previous, seed, oldVersion);
    const registration = corrected.stages.find(s => s.type === 'Регистрация');
    assert.equal(registration.done, false);
    assert.equal(registration.date, '');
    assert.equal(registration.end, '');
    assert.equal(corrected.cred.ct, 'encrypted');
    assert(corrected.stages.filter(s => s.type !== 'Регистрация').every(s => s.done));
    registration.done = true;
    const future = api.mergeSeed(corrected, { ...seed, v: seed.v + 1 }, seed.v);
    assert(future.stages.find(s => s.type === 'Регистрация').done);
    // A device that skipped this release also receives the correction later.
    const skipped = api.mergeSeed(previous, { ...seed, v: seed.v + 1 }, oldVersion);
    assert.equal(skipped.stages.find(s => s.type === 'Регистрация').done, false);
  }
});
