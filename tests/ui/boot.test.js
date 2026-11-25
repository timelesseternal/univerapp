import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/boot.js',import.meta.url),'utf8');
function setup({reduced=false,hidden=false,width=390,height=844}={}) {
  function element(){
    const classes=new Set(),values=new Map(),events=new Map();
    return {hidden:false,inert:false,classes,values,events,
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},
      style:{setProperty:(key,value)=>values.set(key,value)},setAttribute:(key,value)=>values.set(key,value),
      addEventListener:(name,callback)=>events.set(name,callback),removeEventListener:name=>events.delete(name)};
  }
  const root=element(),screen=element(),dot=element(),bloom=element(),targets=[element(),element(),element()];
  root.classes.add('app-booting');targets[2].inert=true;
  dot.getBoundingClientRect=()=>({left:width/2+28,top:height/2+12,width:8,height:8});
  screen.getBoundingClientRect=()=>({left:0,top:0,width,height});
  screen.querySelector=selector=>selector==='.boot-dot'?dot:bloom;
  const timers=new Map();let id=0;
  const ctx=vm.createContext({window:{matchMedia:()=>({matches:reduced})},document:{hidden,documentElement:root,
    getElementById:()=>screen,querySelectorAll:()=>targets},
    setTimeout:(callback,delay)=>{timers.set(++id,{callback,delay});return id;},clearTimeout:key=>timers.delete(key)});
  vm.runInContext(source,ctx);
  return {api:ctx.window.unilinkBoot,root,screen,dot,bloom,targets,timers};
}

test('the expanding dot covers every viewport corner and unlocks the prepared screen at animation end',()=>{
  for(const [width,height] of [[320,740],[390,844],[1280,720]]){
    const s=setup({width,height});assert.ok(s.targets.every(target=>target.inert));
    s.api.finish(true);
    assert.ok(s.screen.classes.has('is-revealing'));
    const x=parseFloat(s.screen.values.get('--boot-x')),y=parseFloat(s.screen.values.get('--boot-y'));
    const radius=Number(s.screen.values.get('--boot-scale'))*4;
    for(const [cx,cy] of [[0,0],[0,height],[width,0],[width,height]])assert.ok(radius>Math.hypot(cx-x,cy-y));
    s.bloom.events.get('animationend')({target:s.bloom,animationName:'bootDotReveal'});
    assert.equal(s.screen.hidden,true);assert.equal(s.root.classes.has('app-booting'),false);
    assert.deepEqual(s.targets.map(target=>target.inert),[false,false,true]);
    assert.equal(s.timers.size,0);
  }
});

test('an expired session or retry exposes the login screen without an accent burst',()=>{
  const s=setup();s.api.finish(false);
  assert.ok(s.screen.classes.has('is-dismissed'));assert.equal(s.screen.classes.has('is-revealing'),false);
  const timer=[...s.timers.values()][0];assert.equal(timer.delay,180);timer.callback();
  assert.equal(s.screen.hidden,true);assert.equal(s.targets[0].inert,false);
});

test('reduced motion and hidden launches finish immediately without animated frames',()=>{
  for(const options of [{reduced:true},{hidden:true}]){
    const s=setup(options);s.api.finish(true);
    assert.equal(s.screen.hidden,true);assert.equal(s.timers.size,0);assert.equal(s.screen.classes.has('is-revealing'),false);
  }
});

test('a missing animation event cannot trap the app and repeated finish calls never replay the launch',()=>{
  const s=setup();s.api.finish(true);s.api.finish(true);
  assert.equal(s.timers.size,1);
  const timer=[...s.timers.values()][0];assert.equal(timer.delay,650);timer.callback();
  s.api.finish(true);assert.equal(s.timers.size,0);assert.equal(s.screen.hidden,true);
});
