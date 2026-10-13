import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../assets/js/viewport-recovery.js',import.meta.url),'utf8');
function setup(ios=true){
  const events=new Map(),frames=[],timers=new Map(),calls=[];
  let timerID=0;
  const listen=owner=>(event,fn)=>events.set(`${owner}:${event}`,fn);
  const viewport={height:759,offsetTop:0,scale:1,addEventListener:listen('viewport')};
  const scroller={scrollTop:0};
  const wrapper={scrollTop:420},messages={scrollTop:600};
  const document={hidden:false,activeElement:null,scrollingElement:scroller,
    documentElement:{classList:{contains:()=>ios}},addEventListener:listen('document')};
  const window={innerHeight:759,innerWidth:393,scrollY:0,visualViewport:viewport,addEventListener:listen('window'),
    requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
    setTimeout:(fn,delay)=>{timers.set(++timerID,{fn,delay});return timerID;},clearTimeout:id=>timers.delete(id),
    scrollTo:options=>{calls.push(options);window.scrollY=0;viewport.offsetTop=0;}};
  vm.runInNewContext(source,{document,window});
  const flush=()=>{while(frames.length)frames.shift()();};
  const emit=event=>{events.get(event)?.();flush();};
  const fireTimers=()=>{for(const {fn} of timers.values())fn();timers.clear();flush();};
  const focus=()=>{document.activeElement={matches:()=>true};emit('document:focusin');};
  return {document,window,viewport,scroller,wrapper,messages,calls,events,emit,fireTimers,focus};
}

test('closing the keyboard restores the outer viewport without touching tab or message scrolling',()=>{
  const app=setup();app.focus();
  app.viewport.height=430;app.viewport.offsetTop=59;app.window.scrollY=59;app.scroller.scrollTop=59;
  app.emit('viewport:resize');assert.equal(app.calls.length,0);
  app.document.activeElement=null;app.emit('document:focusout');app.fireTimers();
  assert.equal(app.calls.length,0); // Blur happens before the keyboard finishes closing.
  app.viewport.height=759;app.emit('viewport:resize');
  assert.equal(app.calls.length,1);assert.equal(app.window.scrollY,0);assert.equal(app.scroller.scrollTop,0);
  assert.equal(app.viewport.offsetTop,0);assert.equal(app.wrapper.scrollTop,420);assert.equal(app.messages.scrollTop,600);
});

test('a late iOS viewport pan is corrected after blur and on returning to the application',()=>{
  const app=setup();app.focus();app.document.activeElement=null;app.emit('document:focusout');
  app.viewport.offsetTop=59;app.window.scrollY=59;app.fireTimers();
  assert.equal(app.window.scrollY,0);assert.equal(app.viewport.offsetTop,0);
  app.window.scrollY=59;app.emit('window:pageshow');assert.equal(app.window.scrollY,0);
});

test('keyboard dismissal with the input still focused restores the screen, without fighting typing',()=>{
  const app=setup();app.focus();app.emit('viewport:resize');assert.equal(app.calls.length,0);
  app.viewport.height=430;app.emit('viewport:resize');assert.equal(app.calls.length,0);
  app.viewport.height=759;app.viewport.offsetTop=59;app.emit('viewport:resize');
  assert.equal(app.calls.length,1);assert.equal(app.viewport.offsetTop,0);
});

test('Android, Telegram, hidden pages and pinch zoom are not reset',()=>{
  const other=setup(false);assert.equal(other.events.size,0);
  const app=setup();app.window.scrollY=59;app.document.hidden=true;app.emit('window:pageshow');
  assert.equal(app.calls.length,0);
  app.document.hidden=false;app.viewport.scale=2;app.emit('viewport:resize');assert.equal(app.calls.length,0);
  app.viewport.scale=1;app.emit('document:visibilitychange');assert.equal(app.window.scrollY,0);
});
