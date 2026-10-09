import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveExplanation,resolveExplanations} from '../public/explanations.mjs';

const entry=()=>({ticket:1,question:2,original:{text:'Оригинал МВД',rule:'ПДД, п. 1.2'},my:{text:'',rule:''}});

test('blank personal field uses original commentary without losing the editable slot',()=>{
  const source=entry();source.my.text='   ';
  const resolved=resolveExplanation(source);
  assert.equal(resolved.text,'Оригинал МВД');assert.equal(resolved.rule,'ПДД, п. 1.2');assert(resolved.draft);
  assert.equal(source.my.text,'   ');assert.equal(source.original.text,'Оригинал МВД');
});

test('personal text takes priority immediately; an empty personal rule falls back to original rule',()=>{
  const source=entry();source.my.text='Мой разбор';
  const resolved=resolveExplanations({'ab-01-02':source})['ab-01-02'];
  assert.equal(resolved.text,'Мой разбор');assert.equal(resolved.rule,'ПДД, п. 1.2');assert.equal(resolved.origin,'authored');assert(!resolved.draft);
  source.my.rule='Моя ссылка';assert.equal(resolveExplanation(source).rule,'Моя ссылка');
});

test('deleting personal explanation returns to original instead of leaving a blank card',()=>{
  const source=entry();source.my.text='Мой разбор';assert.equal(resolveExplanation(source).text,'Мой разбор');
  source.my.text='';assert.equal(resolveExplanation(source).text,'Оригинал МВД');
});

test('invalid or ambiguous explanation structure reports a readable error',()=>{
  const source=entry();source.question='2';assert.throws(()=>resolveExplanation(source),/ticket, question, original и my/);
  const missing=entry();delete missing.my;assert.throws(()=>resolveExplanation(missing),/пояснения/);
});
