import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../assets/js/appearance.js',import.meta.url),'utf8');

test('installed app paints its status area and theme metadata together when switching theme',()=>{
  const attributes=new Map(),variables=new Map(),classes=new Set();
  const root={classList:{add:key=>classes.add(key)},style:{setProperty:(key,value)=>variables.set(key,value)},
    setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),getAttribute:key=>attributes.get(key)};
  const meta={setAttribute:(key,value)=>attributes.set('meta-'+key,value)};
  const store=new Map([['user_color_mode','dark']]);
  const window={navigator:{standalone:true},matchMedia:()=>({matches:false,addEventListener(){}})};
  vm.runInNewContext(source,{window,document:{documentElement:root,querySelector:()=>meta,querySelectorAll:()=>[],addEventListener(){}},
    localStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)}});
  assert.ok(classes.has('standalone-app'));assert.equal(variables.get('--system-bar-bg'),'#070809');
  window.toggleColorMode();
  assert.equal(root.style.backgroundColor,'#f0f2f7');assert.equal(root.style.colorScheme,'light');
  assert.equal(variables.get('--system-bar-bg'),attributes.get('meta-content'));
  assert.equal(store.get('user_color_mode'),'light');
});
