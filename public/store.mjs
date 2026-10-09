import {clone} from './marathon.mjs';

export function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function pack(record) { const text = JSON.stringify(record); return JSON.stringify({text, checksum:checksum(text)}); }
export function unpack(raw) {
  const envelope = JSON.parse(raw);
  if (typeof envelope.text !== 'string' || checksum(envelope.text) !== envelope.checksum) throw new Error('Повреждена сохранённая копия.');
  const record = JSON.parse(envelope.text);
  if (record.schema !== 1 || !Number.isSafeInteger(record.serial) || record.serial < 0 || typeof record.name !== 'string' || !record.daily || !('state' in record)) {
    throw new Error('Не удалось прочитать сохранённые данные.');
  }
  return record;
}
export function freshRecord() { return {schema:1, serial:0, name:'', state:null, daily:{}, latestSummary:null, updatedAt:null}; }
export function dayKey(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Moscow', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
export function addDaily(record, event, now = Date.now()) {
  const key = dayKey(now);
  const stats = record.daily[key] ||= {answered:0, errors:0, repeat_shown:0, repeat_errors:0, closed:0};
  stats.answered++;
  stats.errors += Number(!event.correct);
  stats.repeat_shown += Number(event.repeat);
  stats.repeat_errors += Number(event.repeat && !event.correct);
  stats.closed += Number(event.closed);
}

export class LocalStore {
  constructor(storage, key, validate = () => {}) { this.storage = storage; this.key = key; this.backupKey = key + ':backup'; this.validate = validate; this.recovered = false; }
  load() {
    const raw = this.storage.getItem(this.key);
    const backup = this.storage.getItem(this.backupKey);
    if (!raw && !backup) return freshRecord();
    try { const record = unpack(raw); this.validate(record); return record; }
    catch (firstError) {
      if (!backup) throw firstError;
      const record = unpack(backup); this.validate(record);
      this.storage.setItem(this.key, backup);
      this.recovered = true;
      return record;
    }
  }
  update(expectedSerial, mutate) {
    const current = this.load();
    if (current.serial !== expectedSerial) throw new Error('Прогресс изменился в другой вкладке. Карточка обновлена - выбери ответ ещё раз.');
    const draft = clone(current);
    const result = mutate(draft);
    draft.serial++;
    draft.updatedAt = Date.now();
    this.validate(draft);
    const raw = pack(draft);
    // setItem is atomic: show accepted feedback only after this write succeeds.
    // Keep the previous valid snapshot separately for recovery from damaged data.
    const previous = this.storage.getItem(this.key);
    if (previous) this.storage.setItem(this.backupKey, previous);
    this.storage.setItem(this.key, raw);
    if (this.storage.getItem(this.key) !== raw) throw new Error('Не удалось проверить сохранение. Попробуй ещё раз.');
    return {record:draft, result};
  }
  reset() {
    // Delete the backup first; never resurrect a reset profile from its backup.
    this.storage.removeItem(this.backupKey);
    this.storage.removeItem(this.key);
    return freshRecord();
  }
}
