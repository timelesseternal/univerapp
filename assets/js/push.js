(() => {
  'use strict';
  const state={profile:null,generation:0,busy:false,loaded:false,active:false,telegram:true,registration:null,subscription:null,publicKey:null,error:''};
  let ownerWork=Promise.resolve();
  const byID=id=>document.getElementById(id);
  function available() {
    const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
    const installed=window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone===true;
    if(window.Telegram?.WebApp?.initData) return 'Для push открой unLink. в браузере и добавь на главный экран.';
    if(ios&&!installed) return 'На iPhone добавь unLink. на экран «Домой» и открой с его иконки.';
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)) return 'Этот браузер не поддерживает push. Можно использовать Telegram.';
    return '';
  }
  async function pushWorker() {
    let timeout;
    const registration=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('worker_unavailable')),10000);})]).finally(()=>clearTimeout(timeout));
    if(!registration.active || typeof MessageChannel==='undefined')return registration;
    const supports=()=>new Promise(resolve=>{
      const channel=new MessageChannel();let timer;
      const finish=value=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);};
      channel.port1.onmessage=event=>finish(event.data?.ready===true);
      timer=setTimeout(()=>finish(false),1200);
      try{registration.active.postMessage({type:'UNILINK_PUSH_SUPPORT'},[channel.port2]);}catch{finish(false);}
    });
    if(await supports())return registration;
    await registration.update();
    const worker=registration.installing||registration.waiting||registration.active;
    if(worker.state!=='activated') await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{worker.removeEventListener('statechange',check);reject(new Error('worker_unavailable'));},15000);
      function check(){if(worker.state==='activated'){clearTimeout(timer);worker.removeEventListener('statechange',check);resolve();}}
      worker.addEventListener('statechange',check);check();
    });
    if(!await supports())throw new Error('worker_unavailable');
    return registration;
  }
  async function request(action,{method='GET',body}={},retry=true) {
    const generation=state.generation;
    await window.univerChat?.ensureSession?.();
    if(generation!==state.generation) throw new Error('session_changed');
    const response=await fetch(`/api/chat?action=${action}`,{method,credentials:'same-origin',cache:'no-store',
      headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(response.status===401 && data.error==='chat_session_expired' && retry && generation===state.generation) {
      await window.univerChat?.renewSession?.();
      return request(action,{method,body},false);
    }
    if(!response.ok) throw new Error(data.error||'push_unavailable');
    if(generation!==state.generation) throw new Error('session_changed');
    return data;
  }
  function render() {
    const push=byID('pushEnabled'),telegram=byID('pushTelegram'),status=byID('pushStatus'),retry=byID('pushRetry');
    if(!push||!telegram||!status) return;
    push.checked=state.active;push.disabled=state.busy||!state.loaded||!!available()||!state.registration;
    telegram.checked=state.telegram;telegram.disabled=state.busy||!state.loaded;
    status.textContent=state.error||available()||(!state.loaded?'Подключаем настройки уведомлений…':
      state.active?(state.telegram?'Включены push и дубли сообщений в Telegram.':'Push включены. Дубли сообщений в Telegram выключены.'):'Push выключены на этом устройстве.');
    const title=byID('pushTelegramTitle');if(title)title.textContent=state.active?'Дублировать в Telegram':'Сообщения в Telegram';
    if(retry)retry.hidden=!state.error||state.busy;
    const test=byID('pushTest');if(test){test.hidden=!state.active;test.disabled=state.busy;}
  }
  async function load() {
    if(!state.profile) return;
    const generation=state.generation;state.error='';state.loaded=false;render();
    try {
      const config=await request('push-config');
      if(generation!==state.generation) return;
      state.publicKey=config.publicKey;state.telegram=config.telegramEnabled===true;
      if(!available()) {
        state.registration=await pushWorker();
        if(generation!==state.generation) return;
        const subscription=await state.registration.pushManager.getSubscription();
        if(generation!==state.generation) return;
        state.subscription=subscription;
        if(subscription && Notification.permission!=='granted') {
          await request('push-subscription',{method:'DELETE',body:{endpoint:subscription.endpoint}});
          await subscription.unsubscribe();state.subscription=null;state.active=false;
        } else if(subscription) {
          const status=await request('push-status',{method:'POST',body:{endpoint:subscription.endpoint}});
          if(generation!==state.generation) return;
          state.active=status.active===true;
          if(!state.active) {await subscription.unsubscribe();state.subscription=null;}
        }
      }
      if(generation===state.generation) state.loaded=true;
    }catch(error){if(generation===state.generation)state.error=error.message==='chat_setup_required'?'Уведомления пока не настроены.':'Не удалось загрузить настройки уведомлений. Попробуй ещё раз.';}
    finally{if(generation===state.generation)render();}
  }
  async function togglePush(enabled) {
    if(state.busy||!state.loaded) return;
    const generation=state.generation;state.busy=true;state.error='';render();
    try {
      if(enabled) {
        // Request permission directly in the tap handler, before any network await.
        const permission=await Notification.requestPermission();
        if(generation!==state.generation)return;
        if(permission!=='granted')throw new Error('permission_denied');
        const bytes=Uint8Array.from(atob(state.publicKey.replace(/-/g,'+').replace(/_/g,'/')),character=>character.charCodeAt(0));
        const subscription=state.subscription||await state.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
        if(generation!==state.generation){await subscription.unsubscribe();return;}
        try {await request('push-subscription',{method:'POST',body:{subscription:subscription.toJSON(),disableTelegram:true}});}
        catch(error){await subscription.unsubscribe().catch(()=>{});throw error;}
        if(generation!==state.generation){await subscription.unsubscribe();return;}
        state.subscription=subscription;state.active=true;state.telegram=false;
      } else {
        const subscription=state.subscription;
        if(subscription) {
          await request('push-subscription',{method:'DELETE',body:{endpoint:subscription.endpoint}});
          await subscription.unsubscribe();
        }
        if(generation!==state.generation)return;
        state.subscription=null;state.active=false;
      }
    }catch(error){if(generation===state.generation)state.error=error.message==='permission_denied'?
      'Разрешение не выдано. Уведомления можно разрешить в настройках браузера или iPhone.':'Не удалось изменить push-уведомления. Попробуй ещё раз.';}
    finally{if(generation===state.generation){state.busy=false;render();}}
  }
  async function toggleTelegram(enabled) {
    if(state.busy||!state.loaded)return;
    const generation=state.generation;state.busy=true;state.error='';render();
    try {await request('notification-preferences',{method:'POST',body:{telegramEnabled:enabled}});if(generation===state.generation)state.telegram=enabled;}
    catch{if(generation===state.generation)state.error='Не удалось изменить настройку Telegram. Попробуй ещё раз.';}
    finally{if(generation===state.generation){state.busy=false;render();}}
  }
  window.unilinkPush={
    render,
    onProfile(profile) {
      // A renewed chat session has a new cookie even for the same account.
      // Touch the subscription again so foreground checks follow this device's current session.
      if(state.profile?.id===profile.id){load();return;}
      state.generation++;state.profile=profile;state.loaded=false;state.active=false;state.subscription=null;state.registration=null;state.busy=false;
      const generation=state.generation;
      ownerWork=ownerWork.catch(()=>{}).then(()=>window.unilinkPushStorage.set(profile.id));
      ownerWork.then(()=>{if(generation===state.generation)load();}).catch(()=>{if(generation===state.generation){state.error='Хранилище устройства недоступно. Push нельзя безопасно включить.';render();}});
    },
    async logout() {
      const known=state.subscription,registration=state.registration;
      state.generation++;state.profile=null;state.active=false;state.loaded=false;state.busy=false;state.subscription=null;
      ownerWork=ownerWork.catch(()=>{}).then(()=>window.unilinkPushStorage.set(null));
      navigator.serviceWorker?.controller?.postMessage({type:'UNILINK_PUSH_LOGOUT'});
      let subscription=known;
      try {subscription ||= await (registration || await navigator.serviceWorker?.getRegistration?.('/'))?.pushManager.getSubscription();}catch{ /* Owner was already cleared, even if browser storage fails. */ }
      const unsubscribe=subscription?.unsubscribe().catch(()=>{});
      const remove=subscription?fetch('/api/chat?action=push-subscription',{method:'DELETE',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({endpoint:subscription.endpoint}),signal:AbortSignal.timeout(10000)}).catch(()=>{}):Promise.resolve();
      await Promise.allSettled([ownerWork,unsubscribe,remove]);
    },
    read(conversationID) {navigator.serviceWorker?.controller?.postMessage({type:'UNILINK_PUSH_READ',conversationID});},
  };
  document.addEventListener('change',event=>{
    if(event.target.id==='pushEnabled')togglePush(event.target.checked);
    if(event.target.id==='pushTelegram')toggleTelegram(event.target.checked);
  });
  navigator.serviceWorker?.addEventListener?.('message',event=>{
    if(event.data?.type!=='UNILINK_OPEN_CHAT')return;
    const accepted=event.data.owner===state.profile?.id && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(event.data.conversationID||'');
    event.ports?.[0]?.postMessage({handled:accepted||!!state.profile});
    if(accepted)window.univerChat?.openFromPush?.(event.data.conversationID);
  });
  document.addEventListener('click',async event=>{
    if(event.target.closest?.('#pushRetry'))load();
    if(!event.target.closest?.('#pushTest')||state.busy||!state.active)return;
    const generation=state.generation;state.busy=true;state.error='';render();
    try {await request('push-test',{method:'POST',body:{endpoint:state.subscription.endpoint}});if(generation===state.generation)byID('pushStatus').textContent='Тест отправлен. Проверь уведомления устройства.';}
    catch{if(generation===state.generation)state.error='Не удалось отправить тест. Подожди минуту и попробуй снова.';}
    finally{if(generation===state.generation){state.busy=false;if(state.error)render();else{byID('pushTest').disabled=false;byID('pushEnabled').disabled=false;byID('pushTelegram').disabled=false;}}}
  });
})();
