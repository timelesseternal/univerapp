import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/exams.js';
import {sessionHeaders} from '../helpers/session.js';
const session=Buffer.from(JSON.stringify({sid:'sid',token:'token',cookie:'sid=1'})).toString('base64');
const headers=()=>sessionHeaders(session);
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;}});
// Shape read by the v7 StudentExamScheduleViewer, not legacy personExams.
const exam=(overrides={})=>({subjectName:'Математика',examDate:{year:2026,month:12,day:7,dayfWeekNumber:1},examTime:'09:30',buildingName:'Главный корпус',auditoryName:'423',privateField:'excluded',...overrides});

test('exam route requires authentication and GET before contacting Platonus',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw new Error('must not fetch');});
  const missing=response();await handler({method:'GET'},missing);assert.equal(missing.code,401);
  const method=response();await handler({method:'POST',headers:headers()},method);assert.equal(method.code,405);
});
test('exams use the v7 student viewer with self ID 0 and expose academic fields only',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,...options});
    return {ok:true,status:200,json:async()=>({selectedYear:2026,selectedTerm:1,examSchedules:[exam(),exam({subjectName:'Физика',examTime:10,buildingName:null})]})};
  });
  const res=response();await handler({method:'GET',headers:headers(),query:{studentID:'someone-else',year:2000,term:2}},res);
  assert.equal(res.code,200);assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://platonus.kstu.kz/rest/schedule/userSchedule/student/exam/initial/0/ru');
  assert.equal(calls[0].method,'GET');assert.equal(calls[0].body,undefined);
  assert.equal(calls[0].headers.Cookie,'sid=1');assert.ok(calls[0].signal instanceof AbortSignal);
  assert.deepEqual(res.body.exams,[
    {subject:'Математика',date:'07.12.2026',time:'09:30',room:'Главный корпус, 423'},
    {subject:'Физика',date:'07.12.2026',time:'10:00',room:'423'},
  ]);
});
test('only a confirmed v7 empty schedule is returned as empty; malformed/legacy replies stay errors',async t=>{
  for(const data of [{examSchedules:[]},null,{}, {total:0,examList:[]},{examSchedules:[null]},
    {examSchedules:[exam({subjectName:' '})]}, {examSchedules:[exam({examDate:{year:2026,month:2,day:30}})]},
    {examSchedules:[exam({examDate:{year:2026,month:0,day:1}})]}, {examSchedules:[exam({examTime:24})]},
    {examSchedules:[exam({buildingName:{name:'wrong'}})]}]){
    t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:async()=>data}));
    const res=response();await handler({headers:headers()},res);
    assert.equal(res.code,Array.isArray(data?.examSchedules)&&data.examSchedules.length===0?200:502);
    if(res.code===502)assert.equal(res.body.exams,undefined);
  }
});
test('upstream authentication, network, status and JSON failures never become empty schedules',async t=>{
  for(const status of [401,403,503]){
    t.mock.method(globalThis,'fetch',async()=>({ok:false,status}));const res=response();await handler({headers:headers()},res);
    assert.equal(res.code,status===503?502:401);
  }
  for(const reply of [()=>{throw new Error('offline');},async()=>({ok:true,status:200,json:async()=>{throw new Error('html');}})]){
    t.mock.method(globalThis,'fetch',reply);const res=response();await handler({headers:headers()},res);assert.equal(res.code,502);
  }
});
test('calendar date parts preserve January and leap days without timezone shifts',async t=>{
  t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:async()=>({examSchedules:[
    exam({examDate:{year:2027,month:1,day:2},examTime:0}),exam({examDate:{year:2028,month:2,day:29}}),
  ]})}));
  const res=response();await handler({headers:headers()},res);
  assert.equal(res.code,200);assert.equal(res.body.exams[0].date,'02.01.2027');assert.equal(res.body.exams[0].time,'00:00');
  assert.equal(res.body.exams[1].date,'29.02.2028');
});
