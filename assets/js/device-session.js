// Cookie-independent recovery for remembered logins. No passwords or readable
// Platonus credentials; the encrypted envelope requires this device's private key.
(() => {
  'use strict';
  const DB_NAME='unilink-device',STORE='credentials',ACTIVE='remembered-login';
  const purpose='unilink-remembered-device-v1';
  let storageWork=Promise.resolve();

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
    const work=storageWork.catch(()=>{}).then(()=>transaction(mode,operation));
    storageWork=work.catch(()=>{});
    return work;
  }
  async function clear(){
    if(typeof indexedDB==='undefined')return;
    await stored('readwrite',store=>store.delete(ACTIVE));
  }
  async function prepare(){
    if(!window.crypto?.subtle || typeof indexedDB==='undefined')return null;
    // Verify that persistent storage is available before creating a remembered login.
    await stored('readonly',store=>store.get(ACTIVE));
    const keys=await window.crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
    const publicKey=await window.crypto.subtle.exportKey('jwk',keys.publicKey);
    return {
      publicKey,
      async save(deviceSession){
        if(typeof deviceSession!=='string' || !deviceSession.startsWith('d1.') || deviceSession.length>6000)throw new Error('invalid_device_session');
        await stored('readwrite',store=>store.put({version:1,privateKey:keys.privateKey,deviceSession},ACTIVE));
      },
    };
  }
  async function post(body,isCurrent){
    if(!isCurrent())throw new Error('session_changed');
    const response=await fetch('/api/session',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000),
    });
    if(!isCurrent())throw new Error('session_changed');
    if(response.status===401)return null;
    if(!response.ok)throw new Error('session_check_unavailable');
    const data=await response.json();
    if(!data.ok)throw new Error('session_check_unavailable');
    return data;
  }
  async function restore(isCurrent=()=>true){
    if(!window.crypto?.subtle || typeof indexedDB==='undefined')return false;
    let saved;
    try{saved=await stored('readonly',store=>store.get(ACTIVE));}
    catch{throw new Error('device_storage_unavailable');}
    if(!isCurrent())throw new Error('session_changed');
    if(!saved)return false;
    if(saved.version!==1 || saved.privateKey?.type!=='private' || saved.privateKey.extractable!==false
      || saved.privateKey.algorithm?.name!=='ECDSA' || saved.privateKey.algorithm.namedCurve!=='P-256'
      || typeof saved.deviceSession!=='string' || saved.deviceSession.length>6000){
      await clear();return false;
    }
    const {deviceSession,privateKey}=saved;
    const challenge=await post({action:'challenge',deviceSession},isCurrent);
    if(!challenge){await clear();return false;}
    if(typeof challenge.challenge!=='string' || challenge.challenge.length>180)throw new Error('session_check_unavailable');
    let bytes;
    try{
      bytes=new Uint8Array(await window.crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,
        new TextEncoder().encode(`${purpose}\n${challenge.challenge}`)));
    }catch{await clear();return false;}
    const signature=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    const result=await post({action:'restore',deviceSession,challenge:challenge.challenge,signature},isCurrent);
    if(!result){await clear();return false;}
    return true;
  }
  window.unilinkDeviceSession={prepare,restore,clear};
})();
