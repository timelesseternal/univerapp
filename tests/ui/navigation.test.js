import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/navigation.js',import.meta.url),'utf8');
function setup(){
  const nodes=new Map(),events={},stack=[null],actions=[];
  let index=0,observer,loggedOut=false;
  function node(id){if(!nodes.has(id))nodes.set(id,{shown:false,getClientRects(){return this.shown?[{}]:[];},
    classList:{contains:()=>false},querySelector:()=>null,click(){actions.push(id);}});return nodes.get(id);}
  const history={get state(){return stack[index];},replaceState(state){stack[index]=state;},pushState(state){stack.splice(++index);stack.push(state);},go(n){index+=n;},back(){this.go(-1);}};
  const window={history,addEventListener:(event,fn)=>events[event]=fn,MutationObserver:class{constructor(fn){observer=fn;}observe(){}}};
  const document={body:{classList:{contains:()=>loggedOut}},getElementById:node,querySelector:()=>null};
  vm.runInNewContext(source,{window,document,Date,Math});
  const pop=()=>events.popstate({state:history.state});
  const nativeBack=()=>{history.back();pop();};
  node('chatBack').click=()=>{actions.push('chat');node('chatThread').shown=false;};
  node('chatProfileBack').click=()=>{actions.push('profile');node('chatPeerProfile').shown=false;node('chatThread').shown=true;};
  return {node,actions,history,observer,nativeBack,pop,stack,logout:()=>{loggedOut=true;observer();}};
}
test('native back closes peer profile, then the conversation, one level at a time',()=>{
  const app=setup();app.node('sectionChat').shown=true;app.node('chatThread').shown=true;app.observer();
  app.node('chatThread').shown=false;app.node('chatPeerProfile').shown=true;app.observer();
  assert.equal(app.stack.length,3);
  app.nativeBack();assert.deepEqual(app.actions,['profile']);
  app.nativeBack();assert.deepEqual(app.actions,['profile','chat']);
});
test('UI Back consumes history without closing the underlying screen twice',()=>{
  const app=setup();app.node('sectionChat').shown=true;app.node('chatThread').shown=true;app.observer();
  app.node('chatPeerProfile').shown=true;app.observer();
  app.node('chatProfileBack').click();app.observer();app.pop();
  assert.deepEqual(app.actions,['profile']);
  app.nativeBack();assert.deepEqual(app.actions,['profile','chat']);
});
test('ordinary updates do not add entries and leaving a tab clears nested history',()=>{
  const app=setup();app.node('sectionChat').shown=true;app.node('chatThread').shown=true;app.observer();
  app.observer();app.observer();assert.equal(app.stack.length,2);
  app.node('sectionChat').shown=false;app.observer();app.pop();
  assert.deepEqual(app.actions,[]);assert.equal(app.history.state.unilinkNavigation.depth,0);
});
test('logout consumes private navigation without invoking old chat actions',()=>{
  const app=setup();app.node('sectionChat').shown=true;app.node('chatThread').shown=true;app.observer();
  app.logout();app.pop();assert.deepEqual(app.actions,[]);assert.equal(app.history.state.unilinkNavigation.depth,0);
});
