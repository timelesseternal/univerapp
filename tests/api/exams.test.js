import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/exams.js';
import {sessionHeaders} from '../helpers/session.js';
const session=Buffer.from(JSON.stringify({sid:'sid',token:'token',cookie:'sid=1'})).toString('base64');
const headers=()=>sessionHeaders(session);
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;}});
const exam=(subject='Математика')=>({subject,date:'12.12.2026',time:'09:00',auditoryName:'ГК 423',privateField:'excluded'});

test('exam route requires authentication and GET before contacting Platonus',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw new Error('must not fetch');});
  const missing=response();await handler({method:'GET'},missing);assert.equal(missing.code,401);
  const method=response();await handler({method:'POST',headers:headers()},method);assert.equal(method.code,405);
});
test('exams use the authenticated person endpoint, load all pages and expose academic fields only',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,...options,body:JSON.parse(options.body)});
    return {ok:true,status:200,json:async()=>({total:3,examList:calls.length===1?[exam(),exam('Физика')]:[exam('Информатика')]})};
  });
  const res=response();await handler({method:'GET',headers:headers(),query:{studentID:'someone-else'}},res);
  assert.equal(res.code,200);assert.equal(res.body.exams.length,3);assert.equal(calls.length,2);
  assert.equal(calls[0].url,'https://platonus.kstu.kz/rest/exam_schedule/personExams/ru');
  assert.deepEqual(calls[0].body,{type:1,partNumber:0,countInPart:100});assert.equal(calls[1].body.partNumber,1);
  assert.equal(calls[0].headers.Cookie,'sid=1');assert.equal(calls[0].signal,calls[1].signal);
  assert.deepEqual(res.body.exams[0],{subject:'Математика',date:'12.12.2026',time:'09:00',room:'ГК 423'});
});
test('only a confirmed empty exam list is returned as empty; failures stay errors',async t=>{
  for(const data of [{total:0,examList:[]},null,{}, {total:2,examList:[]},{total:1,examList:[null]}]){
    t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:async()=>data}));
    const res=response();await handler({headers:headers()},res);
    assert.equal(res.code,data?.total===0?200:502);
  }
  for(const status of [401,403,503]){
    t.mock.method(globalThis,'fetch',async()=>({ok:false,status}));const res=response();await handler({headers:headers()},res);
    assert.equal(res.code,status===503?502:401);
  }
});
test('a repeated upstream page cannot loop forever or return incomplete exams',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:true,status:200,json:async()=>({total:100,examList:[exam()]})};});
  const res=response();await handler({headers:headers()},res);
  assert.equal(res.code,502);assert.equal(calls,2);assert.equal(res.body.exams,undefined);
});
