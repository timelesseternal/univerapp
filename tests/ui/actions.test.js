import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/actions.js',import.meta.url),'utf8');
test('delegated actions accept only named actions with literal arguments, including SVG clicks',()=>{
  const handlers={},calls=[];
  const window={selectDay:(...args)=>calls.push(args),selectCityListItem:(...args)=>calls.push(args)};
  vm.runInNewContext(source,{document:{addEventListener:(name,fn)=>{handlers[name]=fn;}},window});
  const click=(action,disabled=false)=>{
    const element={dataset:{action},disabled};handlers.click({target:{closest:()=>element}});return element;
  };
  const element=click("selectDay('Понедельник', this)");
  assert.equal(calls[0][0],'Понедельник');assert.equal(calls[0][1],element);
  click("selectCityListItem('O\\'Brien')");assert.equal(calls[1][0],"O'Brien");
  for(const bad of ['alert(1)',"selectDay(window.location)","selectDay('x');alert(1)","selectDay('x',)","constructor('alert(1)')"])
    click(bad);
  click("selectDay('x')",true);assert.equal(calls.length,2);
});
