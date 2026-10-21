import test from 'node:test';
import assert from 'node:assert/strict';
import grades from '../../api/grades.js';
import schedule from '../../api/schedule.js';
import umkd from '../../api/umkd.js';
import pdf from '../../api/umkd-file.js';
import gpa from '../../api/gpa.js';
import { sessionHeaders } from '../helpers/session.js';
import { queryInteger } from '../../api/_lib/request.js';

const session = Buffer.from(JSON.stringify({ sid:'sid', token:'token', cookie:'sid=1' })).toString('base64');
const headers = () => sessionHeaders(session);
const response = () => ({ headers:{}, setHeader(k,v){this.headers[k]=v;},
  status(code){this.code=code;return this;}, json(body){this.body=body;}, send(body){this.body=body;} });

test('numeric queries reject repeated keys, objects, fractions, non-finite values and unsafe integers', () => {
  for (const value of [null, undefined, true, [], ['7'], {}, 'Infinity', Infinity, NaN, '-1', '1.2', 1.2, '9007199254740992']) {
    assert.equal(queryInteger(value), false, String(value));
  }
  assert.equal(queryInteger('0'), true);
  assert.equal(queryInteger('2026',1900,2200), true);
});

test('read-only Platonus routes reject other methods before requesting upstream', async t => {
  t.mock.method(globalThis,'fetch',()=>{throw new Error('must not fetch');});
  for (const handler of [grades,schedule,umkd,pdf,gpa]) {
    const res=response();await handler({method:'POST',headers:headers()},res);
    assert.equal(res.code,405);assert.equal(res.headers.Allow,'GET');
  }
});

test('missing and malformed query values produce 400 without an upstream request', async t => {
  let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;throw new Error('must not fetch');});
  for (const handler of [grades,schedule,umkd,pdf]) {
    for(const query of [undefined,{}, {studentID:['7'],year:['2026'],term:'1'},
      {studentID:'7',year:'NaN',term:'1',fileTypeID:['131'],umkdid:'7'}]) {
      const res=response();await handler({headers:headers(),query},res);assert.equal(res.code,400);
    }
  }
  assert.equal(calls,0);
});

test('a successful HTML response cannot masquerade as a PDF; genuine PDFs retain their bytes', async t => {
  for(const content of ['<!doctype html><title>Login</title>','%PDF-1.7\nexample']) {
    t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,arrayBuffer:async()=>Buffer.from(content)}));
    const res=response();await pdf({headers:headers(),query:{fileTypeID:'131',umkdid:'7'}},res);
    assert.equal(res.code,content.startsWith('%PDF-')?200:502);
    if(res.code===200)assert.equal(res.body.toString(),content);
    else assert.equal(res.body.error,'invalid_pdf');
  }
});

test('invalid upstream GPA and UMKD payloads are not returned as successful data',async t=>{
  for(const handler of [gpa,umkd])for(const body of [null,[],{},'login']) {
    t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:async()=>body}));
    const res=response();await handler({headers:headers(),query:{summary:'1',year:'2026',term:'1'}},res);
    assert.equal(res.code,502);
  }
});

test('UMKD accepts the real records response, including a confirmed empty list',async t=>{
  for(const records of [[],[{umkdID:4922,subjectName:'Web-технологии',tutorName:'Преподаватель'}]]){
    t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:async()=>({records})}));
    const res=response();await umkd({headers:headers(),query:{year:'2026',term:'1'}},res);
    assert.equal(res.code,200);assert.deepEqual(res.body.records,records);
  }
});
