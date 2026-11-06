/* Shared by the page and service worker. Stores an account ID, never message text. */
(() => {
  const target=typeof window==='undefined'?self:window;
  function access(write,value) {
    return new Promise((resolve,reject)=>{
      if(!target.indexedDB){reject(new Error('push_storage_unavailable'));return;}
      const open=target.indexedDB.open('unilink-push-state',1);
      open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('state'))open.result.createObjectStore('state');};
      open.onerror=open.onblocked=()=>reject(new Error('push_storage_unavailable'));
      open.onsuccess=()=>{
        const db=open.result;let result=null;
        try {
          const tx=db.transaction('state',write?'readwrite':'readonly'),store=tx.objectStore('state');
          const request=write?store.put(value,'owner'):store.get('owner');
          request.onsuccess=()=>{result=request.result;};
          tx.oncomplete=()=>{db.close();resolve(write?value:result||null);};
          tx.onerror=tx.onabort=()=>{db.close();reject(new Error('push_storage_unavailable'));};
        }catch{db.close();reject(new Error('push_storage_unavailable'));}
      };
    });
  }
  target.unilinkPushStorage={get:()=>access(false),set:owner=>access(true,owner)};
})();
