export function resolveExplanation(entry) {
  if (!Number.isInteger(entry?.ticket) || !Number.isInteger(entry?.question) ||
      typeof entry.original?.text !== 'string' || !entry.original.text.trim() ||
      typeof entry.original.rule !== 'string' || typeof entry.my?.text !== 'string' || typeof entry.my.rule !== 'string') {
    throw new Error('Не удалось прочитать пояснения. Проверь поля ticket, question, original и my в JSON.');
  }
  const authored = Boolean(entry.my.text.trim());
  return {
    text: authored ? entry.my.text : entry.original.text,
    rule: authored ? entry.my.rule || entry.original.rule : entry.original.rule,
    draft: !authored,
    origin: authored ? 'authored' : 'official-commentary',
  };
}

export function resolveExplanations(entries) {
  return Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, resolveExplanation(entry)]));
}
