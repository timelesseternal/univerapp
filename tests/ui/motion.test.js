import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/motion.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(reduced=false) {
  const events={},animations=[];
  const document={hidden:false,addEventListener:(name,fn)=>{events[name]=fn;}};
  const ctx=vm.createContext({document,window:{matchMedia:()=>({matches:reduced})},getComputedStyle:()=>({paddingTop:'10',paddingBottom:'10',borderTopWidth:'1',borderBottomWidth:'1'})});
  vm.runInContext(source,ctx);
  const element=(section=false)=>({open:false,isConnected:true,style:{overflow:''},attrs:{},
    classList:{contains:name=>section && name==='app-section'},
    setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];},
    matches:()=>true,querySelector:()=>({getBoundingClientRect:()=>({height:40})}),
    getBoundingClientRect(){return {height:this.open?240:62};},close(){this.open=false;},
    animate(frames,options){let finish,reject;const finished=new Promise((a,b)=>{finish=a;reject=b;});
      const animation={frames,options,finished,finish,cancel(){reject(new Error('cancelled'));this.cancelled=true;}};
      animations.push(animation);return animation;}});
  function click(details) {
    const summary={parentElement:details};
    events.click({target:{closest:selector=>selector==='summary'?summary:null},preventDefault(){}});
  }
  return {api:ctx.window.unilinkMotion,events,animations,element,click,document};
}
test('section transitions never transform fixed chat ancestors; rapid navigation cancels old animation',async()=>{
  const s=setup(),section=s.element(true);
  s.api.enter(section,{x:14});assert.equal(s.animations[0].frames[0].transform,undefined);
  s.api.enter(section);assert.equal(s.animations[0].cancelled,true);
  s.animations[1].finish();await tick();
});
test('day navigation follows weekday direction without animating the dock',()=>{
  const s=setup(),content=s.element();
  s.api.day(content,'Среда','Вторник');assert.match(s.animations[0].frames[0].transform,/-14px/);
  s.api.day(content,'Вторник','Четверг');assert.match(s.animations[1].frames[0].transform,/\(14px/);
});
test('rapid disclosure taps reverse the target and release clipping after completion',async()=>{
  const s=setup(),details=s.element();
  s.click(details);assert.equal(details.open,true);
  s.click(details);assert.equal(details.attrs['data-motion-expanded'],'false');
  s.animations.at(-1).finish();await tick();
  assert.equal(details.open,false);assert.equal(details.style.overflow,'');
  assert.equal(details.attrs['data-motion-expanded'],undefined);
});
test('late grade content cannot reopen a disclosure being closed',async()=>{
  const s=setup(),details=s.element();details.open=true;
  s.click(details);
  const body={closest:()=>details};s.api.replace(body,'new grades');
  assert.equal(body.innerHTML,'new grades');
  s.animations.at(-1).finish();await tick();assert.equal(details.open,false);
});
test('dialog close and Escape remain modal until the animation finishes; repeated close is deduplicated',async()=>{
  const s=setup(),dialog=s.element();dialog.open=true;
  s.events.cancel({target:dialog,preventDefault(){}});s.api.closeDialog(dialog);
  assert.equal(s.animations.length,1);assert.equal(dialog.open,true);
  s.animations[0].finish();await tick();assert.equal(dialog.open,false);
});
test('reduced motion and hidden pages keep native instant operations',()=>{
  const s=setup(true),dialog=s.element();dialog.open=true;
  s.api.enter(dialog);s.api.closeDialog(dialog);assert.equal(s.animations.length,0);assert.equal(dialog.open,false);
});
