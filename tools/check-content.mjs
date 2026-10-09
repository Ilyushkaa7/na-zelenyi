import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {resolveExplanations} from '../public/explanations.mjs';
const root=new URL('../public/',import.meta.url);
const load=name=>JSON.parse(readFileSync(new URL(`content/${name}.json`,root),'utf8'));
const catalog=load('questions'),entries=load('explanations'),explanations=resolveExplanations(entries),ui=load('ui');
const commentary=JSON.parse(readFileSync(new URL('../sources/commentary.json',import.meta.url),'utf8'));
assert.equal(catalog.questions.length,800);assert.equal(new Set(catalog.questions.map(q=>q.id)).size,800);
let images=0;
for(let ticket=1;ticket<=40;ticket++){
  const questions=catalog.questions.filter(q=>q.ticket===ticket);assert.equal(questions.length,20);
  assert.deepEqual(questions.map(q=>q.number),Array.from({length:20},(_,i)=>i+1));
}
for(const q of catalog.questions){
  assert(q.text.trim());assert([2,3,4].includes(q.answers.length));assert.equal(new Set(q.answers.map(a=>a.id)).size,q.answers.length);
  assert(q.answers.every(a=>a.text.trim()));assert(q.answers.some(a=>a.id===q.correct_id));assert(explanations[q.id]?.text.trim());
  if(q.image){assert(/^\/images\/[a-z0-9-]+\.webp$/.test(q.image));assert(existsSync(new URL(q.image.slice(1),root)));images++;}
  assert.equal(entries[q.id].ticket,q.ticket);assert.equal(entries[q.id].question,q.number);
  assert.equal(entries[q.id].original.text,commentary[q.id].text);
  assert.equal(entries[q.id].original.rule,commentary[q.id].rule);
  assert.equal(q.correct_id,commentary[q.id].correct);
}
assert.equal(Object.keys(explanations).length,800);assert.equal(images,541);
const html=readFileSync(new URL('index.html',root),'utf8');assert(!/(?:src|href)="\/(?!\/)/.test(html));
const app=readFileSync(new URL('app.mjs',root),'utf8');assert(!app.includes('/api/'));
for(const match of app.matchAll(/copy\('([a-z_]+)'/g))assert(ui[match[1]],`Missing UI text: ${match[1]}`);
for(const folder of ['/','/TrafficRules/']){
  const base=new URL(folder,'https://example.github.io');
  for(const path of ['app.mjs','styles.css','content/questions.json','images/ab-01-02.webp'])assert(new URL(path,base).pathname.startsWith(folder));
}
const own=Object.values(explanations).filter(e=>e.origin==='authored').length;
console.log(`OK: 800 questions, 541 images, ${own} authored explanations; original/my schema and relative assets verified.`);
