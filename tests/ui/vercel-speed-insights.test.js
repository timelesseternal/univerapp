import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizePerformanceEvent} from '../../assets/js/performance.js';

test('performance events remove private deep links and identifiers before submission',()=>{
  const event={type:'vital',url:'https://example.com/?chat=private-student-id#private',route:'/student/23',value:142};
  const result=sanitizePerformanceEvent(event,'https://example.com');
  assert.equal(result.url,'https://example.com/');assert.equal(result.route,'/');
  assert.equal(result.value,142);assert.equal(event.route,'/student/23');
});

test('invalid and local origins cannot produce performance events',()=>{
  for(const origin of ['invalid','http://localhost:4173','file:///app'])assert.equal(sanitizePerformanceEvent({type:'vital'},origin),null);
});
