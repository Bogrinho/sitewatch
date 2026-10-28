import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transition} from './monitor.mjs';

const base = {name:'Example',url:'https://example.com',status:'up',consecutive_failures:0,
              slow_ms:2000,slow_streak:0,slow_active:0,ssl_alerted:0};
const success = {success:true,response_time_ms:2400,ssl_days_remaining:30};
const fail = {success:false,response_time_ms:null,ssl_days_remaining:null};

test('only the third consecutive failure opens an incident, and recovery closes it',()=>{
  let m=base;
  for(let i=1;i<=4;i++){
    const t=transition(m,fail);
    assert.equal(t.incident,i===3?'open':null);
    m=t.monitor;
  }
  const t=transition(m,{...success,response_time_ms:100});
  assert.equal(t.incident,'resolve');
  assert.equal(t.monitor.status,'up');
  assert.equal(t.monitor.consecutive_failures,0);
});
test('slow and SSL warnings do not repeat until recovered',()=>{
  let m=base, notices=[];
  for(let i=0;i<4;i++){const t=transition(m,{...success,ssl_days_remaining:10});m=t.monitor;notices.push(...t.notices);}
  assert.equal(notices.filter(n=>n.subject.includes('is slow')).length,1);
  assert.equal(notices.filter(n=>n.subject.includes('SSL certificate')).length,1);
  const recovered=transition(m,{...success,response_time_ms:100,ssl_days_remaining:60});
  assert.equal(recovered.monitor.slow_active,0);
  assert.equal(recovered.monitor.ssl_alerted,0);
});
