import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/sw.js',import.meta.url),'utf8');
const owner='11111111-1111-4111-8111-111111111111',conversation='22222222-2222-4222-8222-222222222222';
function setup(){
  const handlers={},shown=[],opened=[],closed=[];let current=owner;
  const existing=[{data:{conversationID:conversation},close:()=>closed.push('chat')}];
  const self={location:{origin:'https://univer.test'},unilinkPushStorage:{async get(){return current;},async set(value){current=value;}},
    addEventListener:(name,handler)=>handlers[name]=handler,registration:{async showNotification(title,options){shown.push({title,...options});},async getNotifications(){return existing;}},
    clients:{async matchAll(){return [];},async openWindow(url){opened.push(url);}}};
  vm.runInNewContext(source,{self,URL});
  const run=async(name,event)=>{let work;handlers[name]({...event,waitUntil(value){work=value;}});await work;};
  return {shown,opened,closed,run,set owner(value){current=value;}};
}
test('push displays with no open windows, but never after logout or for another account',async()=>{
  const ui=setup(),payload={kind:'chat',owner,conversationID:conversation,title:'Собеседник',body:'Привет'};
  await ui.run('push',{data:{json:()=>payload}});assert.equal(ui.shown.length,1);assert.equal(ui.shown[0].body,'Привет');
  ui.owner=null;await ui.run('push',{data:{json:()=>payload}});assert.equal(ui.shown.length,1);
  ui.owner=conversation;await ui.run('push',{data:{json:()=>payload}});assert.equal(ui.shown.length,1);
});
test('notification clicks open only a same-origin conversation, and read/logout close notifications',async()=>{
  const ui=setup();
  let support;await ui.run('message',{data:{type:'UNILINK_PUSH_SUPPORT'},ports:[{postMessage:value=>{support=value;}}]});assert.equal(support.ready,true);
  await ui.run('notificationclick',{notification:{data:{owner,conversationID:conversation,url:'https://evil.test'},close(){}}});
  assert.equal(ui.opened[0],`https://univer.test/?chat=${conversation}`);
  await ui.run('message',{data:{type:'UNILINK_PUSH_READ',conversationID:conversation}});assert.deepEqual(ui.closed,['chat']);
  await ui.run('message',{data:{type:'UNILINK_PUSH_LOGOUT'}});
  await ui.run('notificationclick',{notification:{data:{owner,conversationID:conversation},close(){}}});assert.equal(ui.opened.length,1);
});
