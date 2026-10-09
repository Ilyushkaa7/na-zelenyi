import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Marathon,clone} from '../public/marathon.mjs';
import {LocalStore,pack,freshRecord,addDaily,dayKey} from '../public/store.mjs';
import {resolveExplanations} from '../public/explanations.mjs';

const catalog=JSON.parse(readFileSync(new URL('../public/content/questions.json',import.meta.url),'utf8'));
const explanations=resolveExplanations(JSON.parse(readFileSync(new URL('../public/content/explanations.json',import.meta.url),'utf8')));
const seeded=seed=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
const make=(seed=42)=>new Marathon(catalog,explanations,null,seeded(seed),()=>1000);
const correct=m=>m.questions.get(m.state.pending.id).correct_id;
const wrong=m=>m.state.pending.answers.find(a=>a.id!==correct(m)).id;

test('800 first-time correct answers close all questions exactly once, in thematic groups',()=>{
  const m=make(), seen=new Set();m.next();
  let block;
  for(let i=0;i<800;i++){
    const q=m.state.pending;
    assert(!seen.has(q.id));seen.add(q.id);
    if(i%5===0)block=q.block;else assert.equal(q.block,block);
    m.answer(q.id,correct(m));m.advance();
  }
  assert.equal(seen.size,800);assert.equal(m.progress().closed,800);assert(m.payload().complete);assert.equal(m.state.pending,null);
});

test('wrong answer returns after exact 5-10 intervening cards; corrected answer after 50-75; then closes',()=>{
  for(let seed=1;seed<=35;seed++){
    const m=make(seed);m.next();const id=m.state.pending.id,block=m.state.pending.block;
    const first=m.answer(id,wrong(m));const shortGap=first.payload.feedback.gap;assert(shortGap>=5&&shortGap<=10);
    m.advance();let count=0;
    while(m.state.pending.id!==id){m.answer(m.state.pending.id,correct(m));m.advance();count++;assert(count<20);}
    assert.equal(count,shortGap);assert.equal(m.state.pending.block,block);
    const second=m.answer(id,correct(m));const controlGap=second.payload.feedback.gap;assert(controlGap>=50&&controlGap<=75);
    assert.equal(m.state.items[id].stage,'control');m.advance();count=0;
    while(m.state.pending.id!==id){m.answer(m.state.pending.id,correct(m));m.advance();count++;assert(count<90);}
    assert.equal(count,controlGap);assert.equal(m.state.pending.block,block);
    m.answer(id,correct(m));assert.equal(m.state.items[id].stage,'closed');
  }
});

test('repeated error and control error each restart short cycle',()=>{
  const tiny={...catalog,questions:catalog.questions.slice(0,1)};
  const m=new Marathon(tiny,explanations,null,seeded(5));m.next();const id=m.state.pending.id;
  for(const choose of [()=>wrong(m),()=>wrong(m),()=>correct(m),()=>wrong(m),()=>correct(m),()=>correct(m)]){
    m.answer(id,choose());
    const stage=m.state.items[id].stage;
    if(stage==='short')assert(m.state.feedback.gap>=5&&m.state.feedback.gap<=10);
    m.advance();
  }
  assert(m.payload().complete);assert.equal(m.state.answered,6);
});

test('saved pending answer order and feedback survive reload; finish does not count answer twice',()=>{
  const m=make();m.next();const q=clone(m.state.pending);
  const restored=new Marathon(catalog,explanations,clone(m.state),seeded(900));restored.next();assert.deepEqual(restored.state.pending,q);
  restored.answer(q.id,wrong(restored));const after=clone(restored.state);
  const again=new Marathon(catalog,explanations,after);assert.deepEqual(again.payload().feedback,restored.payload().feedback);
  assert.throws(()=>again.answer(q.id,correct(again)),/уже принят/);
  const summary=again.finish();assert.equal(summary.answered,1);assert.equal(summary.errors,1);
  again.next();assert.equal(again.state.session.answered,0);assert.equal(again.state.answered,1);assert(again.state.feedback);
});

test('each random interval value is reachable and choices use stable IDs',()=>{
  const m=make();for(let i=5;i<=10;i++){m.random=()=>((i-5)+.1)/6;assert.equal(m.integer(5,10),i);}
  for(let i=50;i<=75;i++){m.random=()=>((i-50)+.1)/26;assert.equal(m.integer(50,75),i);}
  const orders=new Set();for(let seed=1;seed<40;seed++){const a=make(seed);a.next();orders.add(a.state.pending.answers.map(x=>x.id).join(','));}
  assert(orders.size>1);
});

class MemoryStorage{
  data=new Map();failKey=null;
  getItem(key){return this.data.get(key)??null;}
  setItem(key,value){if(key===this.failKey)throw Object.assign(new Error('Quota'),{name:'QuotaExceededError'});this.data.set(key,value);}
  removeItem(key){this.data.delete(key);}
}
const validatedStore=storage=>new LocalStore(storage,'test',data=>{if(data.state)new Marathon(catalog,explanations,data.state);});

test('failed primary write leaves previously accepted progress intact',()=>{
  const storage=new MemoryStorage(),store=validatedStore(storage);
  store.update(0,data=>{const m=make();m.next();data.state=m.state;});
  storage.failKey='test';
  assert.throws(()=>store.update(1,data=>{const m=new Marathon(catalog,explanations,data.state);m.answer(m.state.pending.id,correct(m));data.state=m.state;}),/Quota/);
  assert.equal(store.load().state.answered,0);assert.equal(store.load().serial,1);
});

test('corrupt primary restores verified backup; unrepairable data is never silently erased',()=>{
  const storage=new MemoryStorage(),store=validatedStore(storage);
  store.update(0,data=>{data.name='Первое имя';});store.update(1,data=>{data.name='Второе имя';});
  storage.setItem('test','broken');assert.equal(store.load().name,'Первое имя');assert(store.recovered);
  storage.setItem('test','broken');storage.setItem('test:backup','broken backup');assert.throws(()=>store.load());assert.equal(storage.getItem('test'),'broken');
});

test('another tab cannot overwrite newer snapshot, reset removes only this app keys',()=>{
  const storage=new MemoryStorage(),store=validatedStore(storage);storage.setItem('other-site','untouched');
  store.update(0,data=>{data.name='Имя';});
  assert.throws(()=>store.update(0,data=>{data.name='Устаревшее';}),/другой вкладке/);
  assert.equal(store.load().name,'Имя');store.reset();assert.deepEqual(store.load(),freshRecord());assert.equal(storage.getItem('other-site'),'untouched');assert.equal(storage.getItem('test:backup'),null);
});

test('daily stats use Moscow calendar boundaries and preserve repeat error counts',()=>{
  const record=freshRecord();const a=Date.parse('2026-10-09T20:59:59Z'),b=a+1000;
  assert.equal(dayKey(a),'2026-10-09');assert.equal(dayKey(b),'2026-10-10');
  addDaily(record,{correct:false,repeat:true,closed:false},a);addDaily(record,{correct:true,repeat:true,closed:true},b);
  assert.equal(record.daily['2026-10-09'].repeat_errors,1);assert.equal(record.daily['2026-10-10'].closed,1);
});

test('invalid catalog revision and damaged queue are rejected without mutation of stored snapshot',()=>{
  const m=make();m.next();const saved=clone(m.state);saved.revision='old';
  assert.throws(()=>new Marathon(catalog,explanations,saved),/Редакция/);
  const storage=new MemoryStorage();const record=freshRecord();record.state=clone(m.state);record.state.items[m.state.pending.id].attempts=2;
  const raw=pack(record);storage.setItem('test',raw);assert.throws(()=>validatedStore(storage).load(),/счётчик/);assert.equal(storage.getItem('test'),raw);
});

test('mixed wrong answers, serialized due repeats and reloads eventually complete marathon',()=>{
  for(let seed=50;seed<55;seed++){
    let m=make(seed);m.next();let count=0;
    while(m.state.pending){
      const item=m.state.items[m.state.pending.id];
      m.answer(m.state.pending.id,item.attempts===0&&count%3===0 ? wrong(m) : correct(m));
      if(count%17===0)m=new Marathon(catalog,explanations,clone(m.state),seeded(count+seed));
      m.advance();count++;assert(count<1500);
    }
    assert(m.payload().complete);assert.equal(m.progress().closed,800);
  }
});

test('two corrected PDF choice markers restore pending cards without losing accepted progress',()=>{
  for(const [id,missing] of [['ab-07-05','3'],['ab-28-04','4']]){
    const q=catalog.questions.find(q=>q.id===id);
    const oldCatalog={...catalog,questions:[{...q,answers:q.answers.filter(a=>a.id!==missing)}]};
    const old=new Marathon(oldCatalog,explanations,null,seeded(3));old.next();
    const order=old.state.pending.answers.map(a=>a.id);
    old.answer(id,q.correct_id);
    const saved=clone(old.state);
    const restored=new Marathon({...catalog,questions:[q]},explanations,saved);
    assert.deepEqual(restored.state.pending.answers.map(a=>a.id),[...order,missing]);
    assert.equal(restored.state.answered,1);assert.equal(restored.state.items[id].stage,'closed');
    assert.equal(restored.state.feedback.correct,true);
    assert(restored.state.pending.answers.every(a=>a.text===q.answers.find(b=>b.id===a.id).text));
    const damaged=clone(saved);damaged.pending.answers[0].id='unknown';
    assert.throws(()=>new Marathon({...catalog,questions:[q]},explanations,damaged),/карточка/);
  }
});
