export const clone = value => JSON.parse(JSON.stringify(value));

export class Marathon {
  constructor(catalog, explanations, state = null, random = Math.random, now = Date.now) {
    this.catalog = catalog;
    this.questions = new Map(catalog.questions.map(q => [q.id, q]));
    this.explanations = explanations;
    this.random = random;
    this.now = now;
    this.state = state || {
      revision: catalog.revision, answered: 0, clock: 0,
      items: Object.fromEntries(catalog.questions.map(q => [q.id, {stage:'fresh', due:0, attempts:0}])),
      plan: [], pending: null, feedback: null, session: null,
    };
    this.validate();
  }

  validate() {
    const s = this.state;
    if (s.revision !== this.catalog.revision) throw new Error('Редакция билетов изменилась. Прогресс не удалён - нужен перенос на новую редакцию.');
    if (!s.items || Object.keys(s.items).length !== this.questions.size ||
        !Number.isSafeInteger(s.answered) || s.answered < 0 || !Number.isSafeInteger(s.clock) || s.clock < s.answered ||
        !Array.isArray(s.plan) || new Set(s.plan).size !== s.plan.length || s.plan.some(id => !this.questions.has(id))) {
      throw new Error('Повреждены сохранённые данные марафона.');
    }
    let attempts = 0;
    for (const id of this.questions.keys()) {
      const item = s.items[id];
      if (!item || !['fresh','short','control','closed'].includes(item.stage) ||
          !Number.isSafeInteger(item.due) || item.due < 0 || !Number.isSafeInteger(item.attempts) || item.attempts < 0) {
        throw new Error('Повреждена очередь повторов.');
      }
      attempts += item.attempts;
    }
    if (attempts !== s.answered) throw new Error('Повреждён счётчик ответов.');
    if (s.pending) {
      const q = this.questions.get(s.pending.id);
      const ids = s.pending.answers?.map(a => a.id);
      // Restore the two choices previously merged by PDF punctuation errors.
      // Answer keys are unchanged; keep existing order and accepted progress.
      const missing = {'ab-07-05':'3', 'ab-28-04':'4'}[s.pending.id];
      if (q && missing && ids && ids.length === q.answers.length - 1 &&
          new Set(ids).size === ids.length && !ids.includes(missing) &&
          ids.every(id => q.answers.some(a => a.id === id))) ids.push(missing);
      if (!q || !ids || ids.length !== q.answers.length || new Set(ids).size !== ids.length ||
          ids.some(id => !q.answers.some(a => a.id === id))) throw new Error('Повреждена сохранённая карточка.');
      // Text edits do not lose progress or change the saved answer order.
      s.pending.text = q.text;
      s.pending.image = q.image;
      s.pending.answers = ids.map(id => clone(q.answers.find(a => a.id === id)));
    }
    if (s.feedback && (!s.pending || s.feedback.correct_id !== this.questions.get(s.pending.id).correct_id)) {
      throw new Error('Повреждён сохранённый ответ.');
    }
    if (s.feedback) {
      const explanation = this.explanations[s.pending.id];
      s.feedback.explanation = explanation.text;
      s.feedback.rule = explanation.rule;
      s.feedback.draft = Boolean(explanation.draft);
    }
  }

  choice(values) { return values[Math.floor(this.random() * values.length)]; }
  shuffle(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  integer(min, max) { return min + Math.floor(this.random() * (max - min + 1)); }
  earliest(ids) { return ids.reduce((a,b) => this.state.items[a].due <= this.state.items[b].due ? a : b); }

  start() {
    if (!this.state.session) this.state.session = {started_at:this.now(), answered:0, errors:0, repeat_shown:0, repeat_errors:0, closed:0};
  }
  progress() {
    const items = Object.values(this.state.items);
    return {total:items.length, closed:items.filter(i => i.stage === 'closed').length,
      waiting:items.filter(i => ['short','control'].includes(i.stage)).length, answered:this.state.answered};
  }
  makePlan() {
    const items = this.state.items;
    const available = [...this.questions.keys()].filter(id => items[id].stage !== 'closed');
    if (!available.length) return;
    const fresh = available.filter(id => items[id].stage === 'fresh');
    const repeats = available.filter(id => ['short','control'].includes(items[id].stage));
    if (!fresh.length && repeats.length) this.state.clock = Math.max(this.state.clock, items[this.earliest(repeats)].due - 1);
    const position = this.state.clock + 1;
    const imminent = this.shuffle(repeats.filter(id => items[id].due <= position + 4));
    const anchor = imminent.length ? this.earliest(imminent) : fresh.length ? this.choice(fresh) : this.earliest(repeats);
    const block = this.questions.get(anchor).block;
    const same = available.filter(id => this.questions.get(id).block === block);
    const plan = [];
    for (let offset = 0; offset < 5; offset++) {
      const ready = same.filter(id => !plan.includes(id) && items[id].stage !== 'fresh' && items[id].due <= position + offset);
      const nextFresh = same.filter(id => !plan.includes(id) && items[id].stage === 'fresh');
      if (ready.length) plan.push(this.earliest(this.shuffle(ready)));
      else if (nextFresh.length) plan.push(this.choice(nextFresh));
      else break;
    }
    if (!plan.length && fresh.length) {
      const other = this.choice(fresh);
      plan.push(...this.shuffle(fresh.filter(id => this.questions.get(id).block === this.questions.get(other).block)).slice(0,5));
    }
    this.state.plan = plan;
  }
  next() {
    this.start();
    if (this.state.pending) return this.payload();
    const due = Object.keys(this.state.items).filter(id => ['short','control'].includes(this.state.items[id].stage) && this.state.items[id].due <= this.state.clock + 1);
    if (due.length && this.state.plan.length && this.state.plan[0] !== this.earliest(due)) this.state.plan = [];
    if (!this.state.plan.length) this.makePlan();
    if (!this.state.plan.length) { this.state.feedback = null; return this.payload(); }
    const id = this.state.plan.shift();
    const q = this.questions.get(id);
    this.state.pending = {id, text:q.text, topic:q.topic, block:q.block, image:q.image,
      answers:this.shuffle(clone(q.answers)), repeat:this.state.items[id].attempts > 0};
    this.state.feedback = null;
    return this.payload();
  }
  answer(id, choice) {
    const pending = this.state.pending;
    if (!pending || pending.id !== id || this.state.feedback) throw new Error('Ответ уже принят или карточка изменилась.');
    const q = this.questions.get(id);
    if (!q.answers.some(a => a.id === choice)) throw new Error('Такого варианта ответа нет.');
    const item = this.state.items[id];
    const previous = item.stage;
    const correct = choice === q.correct_id;
    this.start();
    this.state.answered++;
    this.state.clock++;
    item.attempts++;
    const session = this.state.session;
    session.answered++;
    session.repeat_shown += Number(previous !== 'fresh');
    session.errors += Number(!correct);
    session.repeat_errors += Number(!correct && previous !== 'fresh');
    let gap = null;
    if (!correct) { item.stage = 'short'; gap = this.integer(5,10); }
    else if (['fresh','control'].includes(previous)) { item.stage = 'closed'; session.closed++; }
    else { item.stage = 'control'; gap = this.integer(50,75); }
    if (gap !== null) item.due = this.state.clock + gap + 1;
    const explanation = this.explanations[id];
    this.state.feedback = {correct, selected_id:choice, correct_id:q.correct_id,
      explanation:explanation.text, rule:explanation.rule, stage:item.stage, gap, draft:Boolean(explanation.draft)};
    return {payload:this.payload(), event:{correct, repeat:previous !== 'fresh', closed:item.stage === 'closed'}};
  }
  advance() {
    if (!this.state.feedback) throw new Error('Сначала выбери ответ.');
    this.state.pending = null;
    return this.next();
  }
  finish() {
    const summary = {...clone(this.state.session || {}), progress:this.progress(), finished_at:this.now()};
    this.state.session = null;
    return summary;
  }
  payload() {
    return {question:this.state.pending, feedback:this.state.feedback, progress:this.progress(),
      session:this.state.session, complete:Object.values(this.state.items).every(i => i.stage === 'closed')};
  }
}
