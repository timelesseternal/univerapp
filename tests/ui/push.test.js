import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../assets/js/push.js',import.meta.url),'utf8');
const settle=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
function setup({permission='granted',saveFails=false}={}) {
  const elements=new Map(),events={},calls=[];let owner=null,unsubscribed=0,subscribed=0;
  const element=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,checked:false,disabled:false,textContent:''});return elements.get(id);};
  const subscription={endpoint:'https://web.push.apple.com/device',toJSON(){return {endpoint:this.endpoint,keys:{}};},async unsubscribe(){unsubscribed++;return true;}};
  const registration={pushManager:{async getSubscription(){return null;},async subscribe(){subscribed++;calls.push('subscribe');return subscription;}}};
  const window={Notification:{},PushManager:{},matchMedia:()=>({matches:true}),unilinkPushStorage:{async set(value){owner=value;}},univerChat:{async ensureSession(){}}};
  const context={window,navigator:{userAgent:'iPhone',standalone:true,serviceWorker:{ready:Promise.resolve(registration),controller:{postMessage(){}}}},
    document:{getElementById:element,addEventListener:(name,handler)=>events[name]=handler},Notification:{async requestPermission(){calls.push('permission');return permission;},permission:'default'},
    AbortSignal,atob,Uint8Array,setTimeout:()=>1,clearTimeout(){},fetch:async(url,options)=>{
      calls.push({url,body:options.body?JSON.parse(options.body):null});
      const data=url.includes('push-config')?{publicKey:'aGVsbG8',telegramEnabled:true}:{ok:true};
      return {ok:!(saveFails&&url.includes('push-subscription')&&options.method==='POST'),json:async()=>data};
    }};
  vm.runInNewContext(source,context);
  return {api:window.unilinkPush,elements,events,calls,get owner(){return owner;},get unsubscribed(){return unsubscribed;},get subscribed(){return subscribed;}};
}
test('permission is never automatic; enabling push saves the device and disables Telegram duplicates',async()=>{
  const ui=setup();ui.api.onProfile({id:'me'});await settle();
  assert.equal(ui.calls.includes('permission'),false);
  assert.equal(ui.elements.get('pushEnabled').disabled,false);
  ui.events.change({target:{id:'pushEnabled',checked:true}});await settle();
  assert.equal(ui.owner,'me');assert.equal(ui.subscribed,1);
  const saved=ui.calls.find(call=>call.url?.includes('push-subscription'));
  assert.equal(saved.body.disableTelegram,true);
  assert.equal(ui.elements.get('pushTelegram').checked,false);
  assert.equal(ui.elements.get('pushEnabled').checked,true);
  ui.events.change({target:{id:'pushTelegram',checked:true}});await settle();
  assert.equal(ui.calls.at(-1).body.telegramEnabled,true);
  await ui.api.logout();assert.equal(ui.owner,null);assert.equal(ui.unsubscribed,1);
});
test('denied permission and failed registration preserve the existing Telegram channel',async()=>{
  const denied=setup({permission:'denied'});denied.api.onProfile({id:'me'});await settle();
  denied.events.change({target:{id:'pushEnabled',checked:true}});await settle();
  assert.equal(denied.subscribed,0);assert.equal(denied.elements.get('pushTelegram').checked,true);
  const failed=setup({saveFails:true});failed.api.onProfile({id:'me'});await settle();
  failed.events.change({target:{id:'pushEnabled',checked:true}});await settle();
  assert.equal(failed.elements.get('pushEnabled').checked,false);assert.equal(failed.elements.get('pushTelegram').checked,true);
  assert.equal(failed.unsubscribed,1);
});
test('an iPhone browser tab explains installation instead of requesting permission',async()=>{
  const elements=new Map(),context={window:{matchMedia:()=>({matches:false})},navigator:{userAgent:'iPhone'},document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},addEventListener(){}}};
  vm.runInNewContext(source,context);context.window.unilinkPush.render();
  assert.match(elements.get('pushStatus').textContent,/экран «Домой»/);assert.equal(elements.get('pushEnabled').disabled,true);
});
