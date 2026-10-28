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
