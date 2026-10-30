import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTarget, assertPublicDns, safeFetch} from './targets.mjs';

test('accepts public HTTPS names and rejects local and numeric targets',()=>{
  assert.equal(normalizeTarget('https://Example.com/path'),'https://example.com/path');
  for(const url of ['http://example.com','https://localhost','https://127.1','https://0x7f000001',
    'https://[::1]','https://service.internal','https://example.com:8443','https://user:secret@example.com',
    'https://example.com/#token']) assert.throws(()=>normalizeTarget(url));
});

test('rejects DNS answers containing private addresses',async()=>{
  const dns=async url=>new Response(JSON.stringify({Status:0,Answer:String(url).includes('type=A%26')?[]:[{type:1,data:'10.0.0.1'}]}));
  await assert.rejects(assertPublicDns('safe-looking.org',dns));
});

test('validates every redirect target before following it',async()=>{
  const seen=[];
  const fake=async input=>{
    const u=new URL(input);
    if(u.hostname==='cloudflare-dns.com')return new Response(JSON.stringify({Status:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}));
    seen.push(u.hostname);
    return new Response(null,{status:302,headers:{location:'https://127.0.0.1/admin'}});
  };
  await assert.rejects(safeFetch('https://public.example.net/',{},fake));
  assert.deepEqual(seen,['public.example.net']);
});

test('response timing excludes safety DNS checks and includes each HTTP redirect hop',async()=>{
  let now=0,requests=0,timing;
  const fake=async(input,options)=>{
    const u=new URL(input);
    if(u.hostname==='cloudflare-dns.com'){
      now+=100;
      return new Response(JSON.stringify({Status:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}));
    }
    assert.equal(options.onTiming,undefined);
    now+=requests++===0?40:60;
    return requests===1?new Response(null,{status:302,headers:{location:'https://other.example.net/'}}):new Response(null,{status:200});
  };
  const response=await safeFetch('https://public.example.net/',{onTiming:value=>{timing=value;}},fake,()=>now);
  assert.equal(response.status,200);
  assert.equal(now,500);
  assert.deepEqual(timing,{responseTimeMs:100,redirects:1});
});

const publicDnsResponse=input=>new Response(JSON.stringify({Status:0,Answer:new URL(input).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}));

test('an already expired deadline performs no DNS or website requests',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(safeFetch('https://public.example.net/',{signal:controller.signal},async()=>{calls++;}),e=>e.source==='checker'&&e.code==='CHECK_ABORTED');
  assert.equal(calls,0);
});

test('caller cancellation aborts in-flight safety DNS and does not reach website',async()=>{
  const controller=new AbortController();let aborted=0,websiteCalls=0;
  const fake=async(input,{signal})=>{
    if(new URL(input).hostname!=='cloudflare-dns.com'){websiteCalls++;return new Response();}
    return await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true}));
  };
  const timer=setTimeout(()=>controller.abort(),10);
  try{await assert.rejects(safeFetch('https://public.example.net/',{signal:controller.signal},fake),e=>e.source==='checker'&&e.code==='DNS_TIMEOUT');}finally{clearTimeout(timer);}
  assert.equal(aborted,2);assert.equal(websiteCalls,0);
});

test('safety DNS provider failure is distinguished from a non-existent target',async()=>{
  await assert.rejects(assertPublicDns('public.example.net',async()=>new Response('unavailable',{status:503})),e=>e.source==='checker'&&e.code==='DNS_SERVICE_FAILED');
  await assert.rejects(assertPublicDns('public.example.net',async()=>new Response(JSON.stringify({Status:2}))),e=>e.source==='checker'&&e.code==='DNS_RESOLUTION_FAILED');
  await assert.rejects(assertPublicDns('public.example.net',async()=>new Response(JSON.stringify({Status:3}))),e=>e.source==='target'&&e.code==='DNS_NOT_FOUND');
});

test('expired deadline after redirect prevents DNS and HTTP on the next hop',async()=>{
  const controller=new AbortController();let dnsCalls=0,httpCalls=0;
  const fake=async input=>{
    if(new URL(input).hostname==='cloudflare-dns.com'){dnsCalls++;return publicDnsResponse(input);}
    httpCalls++;controller.abort();return new Response(null,{status:302,headers:{location:'https://other.example.net/'}});
  };
  await assert.rejects(safeFetch('https://public.example.net/',{signal:controller.signal},fake),e=>e.source==='checker'&&e.code==='CHECK_ABORTED');
  assert.equal(dnsCalls,2);assert.equal(httpCalls,1);
});

test('target fetch timeout is a target observation, runtime limits are checker faults',async()=>{
  const controller=new AbortController();
  const fake=async input=>{if(new URL(input).hostname==='cloudflare-dns.com')return publicDnsResponse(input);controller.abort();throw controller.signal.reason;};
  await assert.rejects(safeFetch('https://public.example.net/',{signal:controller.signal},fake),e=>e.source==='target'&&e.code==='REQUEST_TIMEOUT');
  const limited=async input=>{if(new URL(input).hostname==='cloudflare-dns.com')return publicDnsResponse(input);throw Error('Too many subrequests');};
  await assert.rejects(safeFetch('https://public.example.net/',{},limited),e=>e.source==='checker'&&e.code==='RESOURCE_LIMIT');
});

test('shared request budget defers before a fetch and is never forwarded to fetcher',async()=>{
  const budget={remaining:2};let calls=0;
  const fake=async(input,options)=>{calls++;assert.equal(options.budget,undefined);assert.equal(options.onTiming,undefined);return publicDnsResponse(input);};
  await assert.rejects(safeFetch('https://public.example.net/',{budget},fake),e=>e.source==='checker'&&e.code==='CHECKER_BUDGET');
  assert.equal(calls,2);assert.equal(budget.remaining,0);
  await assert.rejects(safeFetch('https://public.example.net/',{budget},fake),e=>e.source==='checker'&&e.code==='CHECKER_BUDGET');
  assert.equal(calls,2);
});
