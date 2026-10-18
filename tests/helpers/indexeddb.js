// Minimal asynchronous IndexedDB fixture. structuredClone exercises CryptoKey
// persistence across independently created browser-script contexts.
export function indexedDBFixture(){
  const records=new Map();
  return {records,open(){
    const request={};
    setImmediate(()=>{
      request.result={
        objectStoreNames:{contains:()=>true},close(){},
        transaction(){
          const transaction={};
          transaction.objectStore=()=>Object.fromEntries(['get','put','delete'].map(method=>[method,(...args)=>{
            const query={};
            setImmediate(()=>{
              if(method==='get')query.result=structuredClone(records.get(args[0]));
              if(method==='put')records.set(args[1],structuredClone(args[0]));
              if(method==='delete')records.delete(args[0]);
              query.onsuccess?.();transaction.oncomplete?.();
            });
            return query;
          }]));
          return transaction;
        },
      };
      request.onsuccess?.();
    });
    return request;
  }};
}
