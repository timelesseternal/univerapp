// Cookie-independent recovery and renewal. Credentials remain inside a
// server-encrypted envelope, usable only with this device's private key.
(() => {
  'use strict';
  const telegram=window.Telegram?.WebApp?.initData?window.Telegram.WebApp:null;
  const DB_NAME='unilink-device',STORE='credentials';
  const ACTIVE=telegram?.initDataUnsafe?.user?.id
    ? `remembered-login-tg-${telegram.initDataUnsafe.user.id}`:'remembered-login';
  const NATIVE_KEY='unilink_login_'+(window.location?.host || 'local').replace(/[^a-z0-9_-]/gi,'_').slice(0,100);
  const purpose='unilink-remembered-device-v1';
  let storageWork=Promise.resolve();

  function secureStorage(){
    try{
      const storage=telegram?.isVersionAtLeast?.('9.0') && telegram.SecureStorage;
      return storage && ['getItem','setItem','removeItem'].every(method=>typeof storage[method]==='function')?storage:null;
    }catch{return null;}
  }
  function nativeCall(storage,method,...args){
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('device_storage_unavailable')),5000);
      try{
        storage[method](NATIVE_KEY,...args,(error,value)=>{
          clearTimeout(timer);
          if(error || (method==='setItem' && value!==true))reject(new Error('device_storage_unavailable'));
          else resolve(value);
        });
      }catch(error){clearTimeout(timer);reject(error);}
    });
  }
  function queued(operation){
    const work=storageWork.catch(()=>{}).then(operation);
    storageWork=work.catch(()=>{});
    return work;
  }

  function transaction(mode,operation){
    return new Promise((resolve,reject)=>{
      let database,transaction,result,settled=false;
      const finish=(error)=>{
        if(settled)return;
        settled=true;clearTimeout(timer);database?.close();
        error?reject(error):resolve(result);
      };
      const timer=setTimeout(()=>{
        try{transaction?.abort();}catch{ /* Already finished. */ }
        finish(new Error('device_storage_unavailable'));
      },5000);
      let request;
      try{request=indexedDB.open(DB_NAME,1);}catch(error){finish(error);return;}
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);
      };
      request.onerror=()=>finish(request.error || new Error('device_storage_unavailable'));
      request.onblocked=()=>finish(new Error('device_storage_unavailable'));
      request.onsuccess=()=>{
        database=request.result;
        if(settled){database.close();return;}
        database.onversionchange=()=>database.close();
        try{
          // Finish remembered-login writes on durable storage before reporting
          // success; a force-closed PWA must not depend on a pending disk flush.
          try{transaction=database.transaction(STORE,mode,mode==='readwrite'?{durability:'strict'}:undefined);}
          catch{transaction=database.transaction(STORE,mode);} // Older WebKit.
          const query=operation(transaction.objectStore(STORE));
          query.onsuccess=()=>{result=query.result;};
          transaction.oncomplete=()=>finish();
          transaction.onabort=()=>finish(transaction.error || new Error('device_storage_unavailable'));
          transaction.onerror=()=>finish(transaction.error || new Error('device_storage_unavailable'));
        }catch(error){finish(error);}
      };
    });
  }
  function stored(mode,operation){
    return queued(()=>transaction(mode,operation));
  }
  async function clear(){
    await queued(async()=>{
      const storage=secureStorage(),operations=[];
      if(storage)operations.push(nativeCall(storage,'removeItem'));
      if(typeof indexedDB!=='undefined')operations.push(transaction('readwrite',store=>store.delete(ACTIVE)));
      const results=await Promise.allSettled(operations);
      if(results.some(result=>result.status==='rejected'))throw new Error('device_storage_unavailable');
    });
  }
  async function prepare(){
    const storage=secureStorage();
    if(!window.crypto?.subtle || (!storage && typeof indexedDB==='undefined'))return null;
    if(!storage)await stored('readonly',store=>store.get(ACTIVE));
    // Native secure storage accepts strings. Export only for that OS-protected
    // store; browser fallback still receives a non-exportable CryptoKey.
    const keys=await window.crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},!!storage,['sign','verify']);
    const publicKey=await window.crypto.subtle.exportKey('jwk',keys.publicKey);
    const privateJwk=storage?await window.crypto.subtle.exportKey('jwk',keys.privateKey):null;
    const privateKey=storage?await window.crypto.subtle.importKey('jwk',privateJwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']):keys.privateKey;
    return {
      publicKey,
      async save(deviceSession){
        if(typeof deviceSession!=='string' || !deviceSession.startsWith('d1.') || deviceSession.length>6000)throw new Error('invalid_device_session');
        await queued(async()=>{
          const operations=[];
          if(storage)operations.push(nativeCall(storage,'setItem',JSON.stringify({version:2,privateJwk,deviceSession})));
          if(typeof indexedDB!=='undefined')operations.push(transaction('readwrite',store=>store.put({version:1,privateKey,deviceSession},ACTIVE)));
          const results=await Promise.allSettled(operations);
          if(!results.some(result=>result.status==='fulfilled'))throw new Error('device_storage_unavailable');
        });
      },
    };
  }
  async function post(body,isCurrent){
    if(!isCurrent())throw new Error('session_changed');
    const response=await fetch('/api/session',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(body.refresh===true?35000:20000),
    });
    if(!isCurrent())throw new Error('session_changed');
    if(response.status===401){
      const error=await response.json().catch(()=>({}));
      if(['session_expired','invalid_credentials','reauthentication_required'].includes(error.error))return null;
      throw new Error('session_check_unavailable');
    }
    if(!response.ok)throw new Error('session_check_unavailable');
    const data=await response.json();
    if(!isCurrent())throw new Error('session_changed');
    if(!data.ok)throw new Error('session_check_unavailable');
    return data;
  }
  async function restore(isCurrent=()=>true,refresh=false){
    if(!window.crypto?.subtle)return false;
    let saved;
    const storage=secureStorage();
    if(storage){
      try{
        const raw=await queued(()=>nativeCall(storage,'getItem'));
        const native=raw && JSON.parse(raw);
        if(native?.version===2 && typeof native.deviceSession==='string' && native.deviceSession.length<=6000){
          const privateKey=await window.crypto.subtle.importKey('jwk',native.privateJwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
          saved={version:1,privateKey,deviceSession:native.deviceSession,privateJwk:native.privateJwk};
        }
      }catch{ /* Try the browser copy when native storage is temporarily unavailable. */ }
    }
    if(!saved && typeof indexedDB!=='undefined'){
      try{saved=await stored('readonly',store=>store.get(ACTIVE));}
      catch{return false;} // Unavailable local storage must not hide the login form.
    }
    if(!isCurrent())throw new Error('session_changed');
    if(!saved)return false;
    if(saved.version!==1 || saved.privateKey?.type!=='private' || saved.privateKey.extractable!==false
      || saved.privateKey.algorithm?.name!=='ECDSA' || saved.privateKey.algorithm.namedCurve!=='P-256'
      || typeof saved.deviceSession!=='string' || saved.deviceSession.length>6000){
      await clear().catch(()=>{});return false;
    }
    const {deviceSession,privateKey}=saved;
    const challenge=await post({action:'challenge',deviceSession},isCurrent);
    if(!challenge){await clear().catch(()=>{});return false;}
    if(typeof challenge.challenge!=='string' || challenge.challenge.length>180)throw new Error('session_check_unavailable');
    let bytes;
    try{
      bytes=new Uint8Array(await window.crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,
        new TextEncoder().encode(`${purpose}\n${challenge.challenge}`)));
    }catch{await clear().catch(()=>{});return false;}
    const signature=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    const result=await post({action:'restore',deviceSession,challenge:challenge.challenge,signature,...(refresh?{refresh:true}:{})},isCurrent);
    if(!result){await clear().catch(()=>{});return false;}
    if(typeof result.deviceSession==='string' && result.deviceSession.startsWith('d1.') && result.deviceSession.length<=6000){
      await queued(async()=>{
        if(!isCurrent())return;
        const operations=[];
        if(storage && saved.privateJwk)operations.push(nativeCall(storage,'setItem',JSON.stringify({version:2,privateJwk:saved.privateJwk,deviceSession:result.deviceSession})));
        if(typeof indexedDB!=='undefined')operations.push(transaction('readwrite',store=>store.put({version:1,privateKey,deviceSession:result.deviceSession},ACTIVE)));
        await Promise.allSettled(operations);
      });
    }
    return true;
  }
  window.unilinkDeviceSession={prepare,restore,clear};
})();
