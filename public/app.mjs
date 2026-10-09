import {Marathon, clone} from './marathon.mjs';
import {LocalStore, freshRecord, addDaily, dayKey} from './store.mjs';
import {resolveExplanations} from './explanations.mjs';

const $ = selector => document.querySelector(selector);
const root = $('#app');
const clean = value => String(value ?? '').replace(/[·•—–]/g, '-');
const escape = value => clean(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base = new URL('.', import.meta.url);
const imageURL = path => new URL(path.replace(/^\/+/, ''), base).href;
const key = `trafficrules:nazelenyi:${base.pathname}`;
let catalog, explanations, explanationEntries, ui, store, record = freshRecord(), storageError = null, busy = false;
const copy = (name, vars = {}) => Object.entries(vars).reduce((text,[k,v]) => text.replaceAll(`{${k}}`,v), clean(ui[name] || name));
const engine = data => new Marathon(catalog, explanations, data.state ? clone(data.state) : null);
const showNotice = text => { $('#notice').textContent = clean(text); $('#notice').hidden = !text; };
const showError = text => { $('#error').textContent = clean(text); $('#error').hidden = !text; };
const lock = action => navigator.locks ? navigator.locks.request(key, action) : Promise.resolve().then(action);
const setRoute = route => { if (location.hash === route) render(); else location.hash = route; };

async function change(action) {
  if (busy || storageError) return false;
  busy = true;
  root.querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    const expected = record.serial;
    const saved = await lock(() => store.update(expected, action));
    record = saved.record;
    showError('');
    return true;
  } catch (error) {
    try { record = store.load(); storageError = null; }
    catch (loadError) { storageError = loadError; }
    const message = error.name === 'QuotaExceededError' || error.name === 'SecurityError'
      ? 'Браузер не смог сохранить данные. Ответ не принят. Проверь, разрешено ли хранение данных сайта, и попробуй ещё раз.' : error.message;
    showError(message);
    return false;
  } finally { busy = false; render(); }
}

function statsHTML(stats) {
  return `<dl class="stats"><dt>Ответов</dt><dd>${stats.answered || 0}</dd><dt>Ошибок</dt><dd>${stats.errors || 0}</dd><dt>Повторных ответов</dt><dd>${stats.repeat_shown || 0}</dd><dt>Ошибок на повторе</dt><dd>${stats.repeat_errors || 0}</dd><dt>Вопросов закрыто</dt><dd>${stats.closed || 0}</dd></dl>`;
}
function home() {
  const progress = storageError ? null : engine(record).progress();
  const started = record.state !== null;
  root.innerHTML = `<h1>${escape(copy('home_title'))}</h1><p class="intro">${escape(copy('home_description'))}</p>
    <div class="home-grid"><section class="panel"><h2>${escape(record.name ? `${record.name}, продолжим?` : 'Твой марафон')}</h2>
      <form id="start-form"><label for="home-name">${escape(copy('name_label'))}</label><input id="home-name" maxlength="30" autocomplete="nickname" placeholder="${escape(copy('name_placeholder'))}" value="${escape(record.name)}"><p class="meta">${escape(copy('name_note'))}</p>
      ${progress ? `<p class="progress-number">${progress.closed} из ${progress.total}</p><p>${escape(copy('closed_label'))}</p><progress max="${progress.total}" value="${progress.closed}" aria-label="Закрытые вопросы"></progress>` : ''}
      <button class="primary" type="submit" ${storageError ? 'disabled' : ''}>${escape(copy(started ? 'continue' : 'start'))}</button></form>
      <p class="meta">${escape(copy('home_saved_note'))}</p></section>
    <section><ol class="steps">${['five','retry','control'].map(s=>`<li><div><h3>${escape(copy(`${s}_title`))}</h3><p>${escape(copy(`${s}_description`))}</p></div></li>`).join('')}</ol><p><a href="#explanations">${escape(copy('review_nav'))}</a></p></section></div>`;
  $('#start-form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('#home-name').value.trim();
    if (await change(data => { data.name = name; const m = engine(data); m.next(); data.state = m.state; })) setRoute('#marathon');
  });
}
function study() {
  const m = engine(record);
  const {question:q,feedback:f,progress:p,session:s,complete} = m.payload();
  if (!q) {
    if (complete) root.innerHTML = `<h1>${escape(copy('complete_title'))}</h1><p class="intro">${escape(copy('complete_description'))}</p><div class="actions"><button id="finish" class="primary">${escape(copy('finish'))}</button><a href="#">${escape(copy('home'))}</a></div>`;
    else { home(); return; }
  } else {
    const original = m.questions.get(q.id);
    root.innerHTML = `<div class="study-title"><h1>${escape(record.name ? `${record.name}, решаем ПДД` : copy('study_title'))}</h1><button id="finish" class="secondary">${escape(copy('finish'))}</button></div><div class="study">
      <section class="panel question"><div class="question-meta"><span class="meta">Билет ${original.ticket} - вопрос ${original.number}</span>${q.repeat ? '<span class="badge">Повтор</span>' : ''}</div><p class="meta">${escape(q.topic)}</p><h2>${escape(q.text)}</h2>
      ${q.image ? `<img class="question-image" src="${escape(imageURL(q.image))}" alt="Иллюстрация к вопросу ${original.number} билета ${original.ticket}">` : ''}
      <div class="answers">${q.answers.map((a,index) => {
        const correct = f && a.id === f.correct_id;
        const wrong = f && !f.correct && a.id === f.selected_id;
        return `<button class="answer${correct ? ' correct' : wrong ? ' wrong' : ''}" data-answer="${escape(a.id)}" ${f ? 'disabled' : ''}><span class="answer-number">${index+1}</span><span class="answer-text">${escape(a.text)}${correct || wrong ? `<span class="answer-label">${escape(copy(correct ? 'correct_answer' : 'selected_wrong'))}</span>` : ''}</span></button>`;
      }).join('')}</div>
      ${f ? `<section class="feedback${f.correct ? '' : ' wrong'}" aria-label="Разбор ответа"><h3>${escape(copy(f.correct ? 'correct_title' : 'wrong_title'))}</h3><p>${escape(f.explanation)}</p><p class="meta">${escape(f.rule)}</p>${f.draft ? `<p class="meta">${escape(copy('source_draft'))}</p>` : ''}<p>${escape(copy(f.stage === 'closed' ? 'closed_message' : `${f.stage}_message`, {gap:f.gap}))}</p><p class="meta">${escape(copy('saved_note'))}</p></section><div class="next-row"><button id="next" class="primary">${escape(copy('next'))}</button></div>` : ''}</section>
      <aside class="panel side"><h2>${escape(copy('progress_title'))}</h2><p class="progress-number">${p.closed} из ${p.total}</p><progress value="${p.closed}" max="${p.total}" aria-label="Закрытые вопросы"></progress><dl class="stats"><dt>${escape(copy('waiting_label'))}</dt><dd>${p.waiting}</dd><dt>${escape(copy('session_answered'))}</dt><dd>${s?.answered || 0}</dd><dt>${escape(copy('session_errors'))}</dt><dd>${s?.errors || 0}</dd><dt>${escape(copy('answered_label'))}</dt><dd>${p.answered}</dd></dl><p class="side-note">${escape(copy('tail_note'))}</p></aside></div>`;
    root.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => change(data => {
      const current = engine(data); const result = current.answer(q.id, button.dataset.answer);
      addDaily(data,result.event); data.state = current.state;
    })));
    $('#next')?.addEventListener('click', () => change(data => { const current = engine(data); current.advance(); data.state = current.state; }));
  }
  $('#finish')?.addEventListener('click', async () => {
    if (await change(data => { const current = engine(data); const summary = current.finish(); summary.today = clone(data.daily[dayKey()] || {}); summary.day = dayKey(); data.latestSummary = summary; data.state = current.state; })) setRoute('#summary');
  });
}
function summary() {
  const result = record.latestSummary;
  if (!result) { home(); return; }
  root.innerHTML = `<h1>${escape(copy('summary_title'))}</h1><p class="intro">${escape(copy('summary_saved'))}</p><div class="summary-grid"><section class="panel"><h2>За это занятие</h2>${statsHTML(result)}</section><section class="panel"><h2>За день - ${escape(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long'}).format(result.finished_at))}</h2>${statsHTML(result.today || {})}</section></div><p>Всего закрыто: <strong>${result.progress.closed} из ${result.progress.total}</strong></p><div class="actions"><button id="resume" class="primary">${escape(copy('continue'))}</button><a href="#">${escape(copy('home'))}</a></div>`;
  $('#resume').addEventListener('click',async()=>{ if (await change(data=>{const current=engine(data);current.next();data.state=current.state;})) setRoute('#marathon'); });
}
function review(ticket) {
  const questions = catalog.questions.filter(q => q.ticket === ticket);
  const navigation = `<div class="actions review-navigation">${ticket > 1 ? `<a href="#explanations/${ticket-1}">${escape(copy('review_previous'))}</a>` : ''}${ticket < 40 ? `<a href="#explanations/${ticket+1}">${escape(copy('review_next'))}</a>` : ''}</div>`;
  root.innerHTML = `<h1>${escape(copy('review_title'))}</h1><p class="intro review-intro">${escape(copy('review_description'))}</p><div class="review-picker"><label for="review-ticket">${escape(copy('review_ticket'))}</label><select id="review-ticket">${Array.from({length:40},(_,i)=>`<option value="${i+1}" ${i+1===ticket ? 'selected' : ''}>${escape(copy('review_ticket'))} ${i+1}</option>`).join('')}</select></div>${navigation}<a href="#">${escape(copy('home'))}</a><div class="review-list">${questions.map(q => {
    const e = explanations[q.id];
    const original = explanationEntries[q.id].original;
    return `<article class="panel review-card" id="${escape(q.id)}"><p class="meta">Билет ${q.ticket} - вопрос ${q.number}</p><h2>${escape(q.text)}</h2>${q.image ? `<img class="question-image" src="${escape(imageURL(q.image))}" loading="lazy" alt="Иллюстрация к вопросу ${q.number} билета ${q.ticket}">` : ''}<ol class="review-answers">${q.answers.map(a => `<li${a.id===q.correct_id ? ' class="correct"' : ''}>${escape(a.id)}. ${escape(a.text)}${a.id===q.correct_id ? `<strong>${escape(copy('correct_answer'))}</strong>` : ''}</li>`).join('')}</ol><div class="explanation-comparison"><section class="original-text"><h3>${escape(copy('review_original'))}</h3><p>${escape(original.text)}</p>${original.rule ? `<p class="meta">${escape(original.rule)}</p>` : ''}</section><section class="author-text"><h3>${escape(copy(e.draft ? 'review_original' : 'review_author'))}</h3><p>${escape(e.text)}</p>${e.rule ? `<p class="meta">${escape(e.rule)}</p>` : ''}</section></div></article>`;
  }).join('')}</div>${navigation}`;
  $('#review-ticket').addEventListener('change', event => setRoute(`#explanations/${event.target.value}`));
}
function render() {
  if (!catalog) return;
  if (/^#explanations(?:\/\d+)?$/.test(location.hash)) review(Math.min(40, Math.max(1, Number(location.hash.split('/')[1]) || 1)));
  else if (storageError) home();
  else if (location.hash === '#marathon') study();
  else if (location.hash === '#summary') summary();
  else home();
}

$('#settings-open').addEventListener('click', () => {
  $('#settings-name').value = record.name;
  $('#reset-confirm').hidden = true;
  $('#settings-error').hidden = true;
  $('#settings').showModal();
});
$('#settings-close').addEventListener('click',()=>$('#settings').close());
$('#name-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if (storageError) { $('#settings-error').textContent='Сохранение не удалось прочитать. Имя не изменено.'; $('#settings-error').hidden=false; return; }
  const name=$('#settings-name').value.trim();
  if(await change(data=>{data.name=name;})){ $('#settings').close();showNotice(copy('name_saved')); }
});
$('#reset-open').addEventListener('click',()=>{ $('#reset-confirm').hidden=false; });
$('#reset-cancel').addEventListener('click',()=>{ $('#reset-confirm').hidden=true; });
$('#reset-do').addEventListener('click',async()=>{
  if(busy) return;
  busy=true;
  try{ record=await lock(()=>store.reset());storageError=null;$('#settings').close();showError('');showNotice(copy('reset_done'));setRoute(''); }
  catch(error){$('#settings-error').textContent=clean(error.message);$('#settings-error').hidden=false;}
  finally{busy=false;render();}
});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
window.addEventListener('storage',event=>{
  if(event.key!==key || !store) return;
  try{record=store.load();storageError=null;$('#reset-confirm').hidden=true;render();showNotice(copy('other_tab'));}
  catch(error){storageError=error;showError(error.message);render();}
});

try {
  [catalog, explanations, ui] = await Promise.all(['questions','explanations','ui'].map(async name=>{
    const response = await fetch(new URL(`content/${name}.json`,base), {cache:'no-store'});
    if(!response.ok) throw new Error('Не удалось загрузить материалы. Обнови страницу.');
    return response.json();
  }));
  explanationEntries = explanations;
  explanations = resolveExplanations(explanationEntries);
  $('#review-link').textContent=copy('review_nav');
  $('#source').href=catalog.source_url;
  $('#storage-note').textContent=copy('storage_note');
  try{
    store=new LocalStore(localStorage,key,data=>{if(data.state)engine(data);});
    record=await lock(()=>store.load());
    if(store.recovered)showNotice(copy('recovered'));
  }catch(error){storageError=error;showError(`${error.message} Сохранение не перезаписано. Проверь настройки браузера. Сброс данных доступен в настройках сайта.`);}
  render();
} catch(error){showError(error.message);root.innerHTML='<h1>Не удалось открыть марафон</h1><p>Обнови страницу, чтобы попробовать ещё раз.</p>';}
