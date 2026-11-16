import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const app=readFileSync(new URL('../../assets/js/app.js',import.meta.url),'utf8');
function setup(reduced=false) {
  const transitions=[];
  const element={innerHTML:'',classList:{remove(){}},animate(frames,options){
    const transition={cancelled:false,cancel(){this.cancelled=true;}};
    transitions.push(transition);return transition;
  }};
  const context=vm.createContext({window:{matchMedia:()=>({matches:reduced})},document:{hidden:false}});
  vm.runInContext(app.slice(app.indexOf('  const contentAnimations'),app.indexOf('  function updateDayIndicator')),context);
  return {element,context,transitions};
}
test('rapid content changes cancel previous motion and commit the newest screen immediately',()=>{
  const {element,context,transitions}=setup();let inserted=0;
  context.swapContent(element,'first',true,()=>inserted++);
  context.swapContent(element,'second',true,()=>inserted++);
  assert.equal(element.innerHTML,'second');assert.equal(transitions[0].cancelled,true);assert.equal(inserted,2);
  context.swapContent(element,'fresh data',false);
  assert.equal(transitions[1].cancelled,true);assert.equal(element.innerHTML,'fresh data');
});
test('reduced motion and hidden documents commit without starting animation',()=>{
  const reduced=setup(true);reduced.context.swapContent(reduced.element,'ready');
  assert.equal(reduced.element.innerHTML,'ready');assert.equal(reduced.transitions.length,0);
  const hidden=setup();hidden.context.document.hidden=true;hidden.context.swapContent(hidden.element,'ready');
  assert.equal(hidden.transitions.length,0);
});

test('first results cascade after loading while subsequent silent refreshes remain still',()=>{
  const s=setup();let cascades=0;
  s.context.window.unilinkMotion={cascade:()=>{cascades++;return true;}};
  s.element.innerHTML='content-loading';
  s.element.querySelector=()=>s.element.innerHTML.includes('content-loading')?{}:null;
  s.context.swapContent(s.element,'cards',false);
  assert.equal(cascades,1);assert.equal(s.transitions.length,0);
  s.context.swapContent(s.element,'updated cards',false);
  assert.equal(cascades,1);assert.equal(s.element.innerHTML,'updated cards');
});
