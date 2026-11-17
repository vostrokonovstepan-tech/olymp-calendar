import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { pathToFileURL } from 'node:url';

export async function readCalendar(path = new URL('../index.html', import.meta.url)) {
  const html = await readFile(path, 'utf8');
  const start = html.indexOf('const SEED=[');
  const end = html.indexOf('\n];', start);
  if (start < 0 || end < 0) throw new Error('Не найден календарь SEED в index.html');
  // Only evaluate the repository's own calendar declaration, without browser APIs.
  return new Script(html.slice(start, end + 3) + '; JSON.stringify(SEED)').runInNewContext({}, { timeout: 1000 });
}

export function tomorrowInMoscow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  const day = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

export function reminders(calendar, target) {
  const result = [];
  for (const olympiad of calendar) {
    if (olympiad.kind === 'prep') continue;
    for (const stage of olympiad.stages || []) {
      if (stage.done || stage.rep) continue;
      const start = stage.date || '';
      const end = stage.end || start;
      const starts = start === target;
      const ends = end === target;
      if (!starts && !ends) continue;
      const label = start === end ? 'состоится' : starts ? 'начинается' : 'заканчивается';
      const heading = `${olympiad.name} (${olympiad.subject || 'Другое'})`;
      const detail = `${stage.type}${stage.name ? ' · ' + stage.name : ''}`;
      const time = starts && stage.time ? `, ${stage.time} МСК` : '';
      result.push(`Завтра ${label}: ${heading}\n${detail}${time}`);
    }
  }
  return [...new Set(result)];
}

export function messages(items, target) {
  const header = `🔔 Олимпиады на завтра, ${target.split('-').reverse().join('.')}\n\n`;
  const output = [];
  let text = header;
  for (const item of items) {
    // Leave room under Telegram's 4096-character limit, even for unusually long notes.
    const block = item.slice(0, 3000);
    if ((text + block).length > 3500) { output.push(text.trim()); text = header; }
    text += block + '\n\n';
  }
  if (text !== header) output.push(text.trim());
  return output;
}

export async function sendTelegram(text, { token, chatId, fetchImpl = fetch }) {
  if (!token || !chatId) throw new Error('Добавьте секреты TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в GitHub Actions');
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    // Never print fetch errors: their URL can contain the bot token.
    throw new Error('Не удалось связаться с Telegram. Автоповтор отключён, чтобы не дублировать доставленное сообщение');
  }
  let body;
  try { body = await response.json(); } catch { throw new Error('Telegram вернул некорректный ответ'); }
  if (!response.ok || !body.ok) throw new Error(`Telegram отклонил отправку (HTTP ${response.status}). Проверьте секреты и нажмите /start в боте`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
  if (!dryRun && (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID)) {
    throw new Error('Добавьте секреты TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в GitHub Actions');
  }
  const target = tomorrowInMoscow();
  const texts = messages(reminders(JSON.parse(await readCalendar()), target), target);
  if (dryRun) { console.log(texts.join('\n\n---\n\n') || 'На завтра напоминаний нет'); return; }
  for (const text of texts) await sendTelegram(text, {
    token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID,
  });
  console.log(`Отправлено сообщений: ${texts.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
