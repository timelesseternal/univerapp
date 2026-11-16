import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { normalizeGradeDetails } from '../../api/grade-details.js';
import { sessionHeaders } from '../helpers/session.js';
const session = Buffer.from(JSON.stringify({sid:'sid',token:'token',cookie:'sid=1'})).toString('base64');
const response = () => ({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}});
const point = (day, mark=80) => ({Mark:mark,MarkDate:{Year:2026,Month:9,Day:day},StudentName:'private',Comment:'private'});
const sample = () => [{Id:45904,Name:'NBD 3220-1-Lab',TutorFullName:'Бахатқызы С.',Marks:{9:{Marks:{29:[point(29)],15:[point(15),point(15,0)]}}}}];
const query={year:'2026',term:'1',subjectID:'9048',queryID:'253432'};

test('control points preserve dates, zero and multiple marks on one day, sorted without private fields',()=>{
  const groups=normalizeGradeDetails(sample());
  assert.deepEqual(groups,[{id:45904,name:'NBD 3220-1-Lab',tutor:'Бахатқызы С.',marks:[
    {date:'2026-09-15',mark:80},{date:'2026-09-15',mark:0},{date:'2026-09-29',mark:80},
  ]}]);
  assert.deepEqual(normalizeGradeDetails([]),[]);
  const empty=sample();empty[0].Marks={};assert.deepEqual(normalizeGradeDetails(empty)[0].marks,[]);
  empty[0].Marks=null;assert.deepEqual(normalizeGradeDetails(empty)[0].marks,[]);
  const absent=sample();absent[0].Marks={9:{Marks:{15:[point(15,null)]}}};assert.deepEqual(normalizeGradeDetails(absent)[0].marks,[]);
});
test('malformed replies and invalid dates do not masquerade as no grades',()=>{
  for(const data of [null,{},[null],[{Id:1,Name:'Subject'}]])assert.throws(()=>normalizeGradeDetails(data));
  const bad=sample();bad[0].Marks[9].Marks[15][0].MarkDate={Year:2026,Month:2,Day:30};assert.throws(()=>normalizeGradeDetails(bad));
});

test('numeric strings, decimal commas and explicit empty calendar containers preserve populated lesson groups',()=>{
  const data=sample();
  data[0].Marks[9].Marks[15]=[point(15,' 85 '),point(15,'82,5'),point(15,'0')];
  data[0].Marks[9].Marks[16]=null;
  data[0].Marks[10]={Marks:null};data[0].Marks[11]={Marks:[]};data[0].Marks[12]=null;
  data.push({Id:2,Name:'WT-SRSP',Marks:[]});
  const groups=normalizeGradeDetails(data);
  assert.deepEqual(groups[0].marks.map(value=>value.mark),[85,82.5,0,80]);
  assert.equal(groups[1].marks.length,0);
  assert.equal(JSON.stringify(groups).includes('private'),false);
});

test('Cyrillic attendance marks preserve their dates without turning into a zero or blocking numeric grades',()=>{
  const data=sample();data[0].Marks[9].Marks[15]=[point(15,'н'),point(15,' Н '),point(15,0),point(15,'85')];
  assert.deepEqual(normalizeGradeDetails(data)[0].marks,[
    {mark:null,status:'absent',date:'2026-09-15'},{mark:null,status:'absent',date:'2026-09-15'},
    {mark:0,date:'2026-09-15'},{mark:85,date:'2026-09-15'},{mark:80,date:'2026-09-29'},
  ]);
});

test('a subject response containing attendance and numeric marks loads successfully through the API',async t=>{
  let calls=0;const data=sample();data[0].Marks[9].Marks[15]=[point(15,'н'),point(15,85)];
  t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:async()=>++calls===1?{studentID:7}:data}));
  const res=response();await handler({method:'GET',headers:sessionHeaders(session),query},res);
  assert.equal(res.code,200);assert.equal(res.body.groups[0].marks.length,3);
  assert.equal(res.body.groups[0].marks[0].status,'absent');assert.equal(res.body.groups[0].marks[1].mark,85);
});

test('unsupported marks and populated malformed containers remain errors rather than disappearing',()=>{
  for(const mark of ['не явился','Infinity','100.1','-1','85 баллов',true,{},[]]) {
    const data=sample();data[0].Marks[9].Marks[15]=[point(15,mark)];
    assert.throws(()=>normalizeGradeDetails(data),/invalid_mark/);
  }
  for(const value of [[point(15)],'empty',true]) {
    const data=sample();data[0].Marks[10]={Marks:value};
    assert.throws(()=>normalizeGradeDetails(data),/invalid_month/);
  }
});
test('details derive the student identity on the server and request the real subject endpoint',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options});return {ok:true,status:200,json:async()=>calls.length===1?{studentID:185082}:sample()};
  });
  const res=response();await handler({method:'GET',headers:sessionHeaders(session),query:{...query,studentID:'999'}},res);
  assert.equal(res.code,200);assert.equal(calls[1].url,'https://platonus.kstu.kz/subject/2026/1/9048/185082?queryID=253432');
  assert.equal(calls[1].options.headers.Cookie,'sid=1');assert.equal(calls[1].options.signal,calls[0].options.signal);
  assert.equal(res.body.groups[0].marks.length,3);
});
test('details reject unauthenticated, wrong-method and malformed requests before upstream access',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw new Error('unexpected');});
  for(const [req,code] of [[{method:'GET',query},401],[{method:'POST'},405],
    [{headers:sessionHeaders(session),query:{...query,subjectID:['9048','1']}},400],
    [{headers:sessionHeaders(session),query:{...query,queryID:['253432','1']}},400]]){
    const res=response();await handler(req,res);assert.equal(res.code,code);
  }
});
test('identity and details failures never produce a successful empty list',async t=>{
  for(const failAt of [1,2])for(const status of [401,403,503]){
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{
      calls++;return calls===failAt?{ok:false,status}:{ok:true,status:200,json:async()=>({studentID:185082})};
    });
    const res=response();await handler({headers:sessionHeaders(session),query},res);assert.equal(res.code,status===503?502:401);
  }
});

test('safe diagnostics distinguish malformed data, deadlines and profile failures without exposing upstream content',async t=>{
  for(const reason of ['GD_FORMAT','GD_TIMEOUT','GD_PROFILE','GD_UPSTREAM'])await t.test(reason,async t=>{
    let calls=0;
    t.mock.method(globalThis,'fetch',async()=>{
      calls++;
      if(reason==='GD_TIMEOUT')throw new DOMException('private upstream details','TimeoutError');
      if(reason==='GD_PROFILE')return {ok:false,status:503};
      if(calls===1)return {ok:true,status:200,json:async()=>({studentID:7})};
      if(reason==='GD_UPSTREAM')return {ok:false,status:503};
      const data=sample();data[0].Marks[9].Marks[15]=[point(15,'private unsupported value')];
      return {ok:true,status:200,json:async()=>data};
    });
    const res=response();await handler({method:'GET',headers:sessionHeaders(session),query},res);
    assert.equal(res.code,502);assert.deepEqual(res.body,{error:'grade_details_unavailable',detail:reason==='GD_FORMAT'?'GD_FORMAT_MARK_STRING':reason});
  });
});

test('format diagnostics pinpoint the failing field and distinguish short attendance tokens without exposing arbitrary text',()=>{
  for(const [value,code] of [[-1,'GD_FORMAT_MARK_NUMBER_NEG1'],['НБ','GD_FORMAT_MARK_STRING_U041D_U0411'],
    ['H','GD_FORMAT_MARK_STRING_U0048'],['private student comment','GD_FORMAT_MARK_STRING']]) {
    const data=sample();data[0].Marks[9].Marks[15]=[point(15,value)];
    assert.throws(()=>normalizeGradeDetails(data),error=>error.diagnostic===code);
  }
  const data=sample();data[0].Marks[9].Marks[15][0].MarkDate.Year=0;
  assert.throws(()=>normalizeGradeDetails(data),error=>error.diagnostic==='GD_FORMAT_YEAR_NUMBER_0');
  data[0].Marks[9].Marks[15][0].MarkDate=null;
  assert.throws(()=>normalizeGradeDetails(data),error=>error.diagnostic==='GD_FORMAT_DATE_NULL');
  assert.throws(()=>normalizeGradeDetails({private:'secret'}),error=>error.diagnostic==='GD_FORMAT_ROOT_OBJECT');
});

test('malformed upstream JSON has a separate diagnostic code',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:async()=>{
    if(++calls===1)return {studentID:7};throw new SyntaxError('private upstream data');
  }}));
  const res=response();await handler({method:'GET',headers:sessionHeaders(session),query},res);
  assert.deepEqual(res.body,{error:'grade_details_unavailable',detail:'GD_FORMAT_JSON'});
});
