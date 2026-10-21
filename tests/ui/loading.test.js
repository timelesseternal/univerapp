import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installLoading} from '../helpers/loading.js';

test('shared loading is an accessible rotating arrow without visible text or a notice card',()=>{
  const ctx={window:{}};installLoading(ctx);
  const html=ctx.window.unilinkLoading.html('Материалы "<img src=x>"');
  assert.match(html,/role="status"/);assert.match(html,/aria-label="Материалы &quot;&lt;img/);
  assert.match(html,/content-loading-arrow/);assert.doesNotMatch(html,/notice-panel|<img|<p>|<span/);
  assert.match(ctx.window.unilinkLoading.html('Загрузка',true),/^<span[^>]*content-loading-compact/);
  const css=readFileSync(new URL('../../assets/css/controls.css',import.meta.url),'utf8');
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('loading module is available before the academic and application scripts and belongs to the offline shell',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const loading=html.indexOf('src="./assets/js/loading.js"');
  assert.ok(loading>=0 && loading<html.indexOf('src="./assets/js/academic.js"'));
  assert.ok(loading<html.indexOf('src="./assets/js/app.js"'));
  assert.match(readFileSync(new URL('../../assets/js/sw.js',import.meta.url),'utf8'),/SHELL_PATHS.add\('\/assets\/js\/loading.js'\)/);
});
