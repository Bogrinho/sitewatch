const blockedSuffixes = ['localhost','local','internal','invalid','test','example','onion'];

// Only public HTTPS hostnames on the default port. URL() canonicalizes numeric IP
// forms (including decimal and hex) so those are rejected along with literal IPs.
export function normalizeTarget(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid HTTPS URL.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid HTTPS URL.'); }
  const hostname=url.hostname.toLowerCase().replace(/\.$/,'');
  if(url.protocol!=='https:' || url.username || url.password || url.port || url.hash ||
     hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname) ||
     hostname.length>253 || !hostname.includes('.') ||
     !hostname.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x)) ||
     blockedSuffixes.some(s=>hostname===s||hostname.endsWith('.'+s)))
    throw new Error('Use a public HTTPS domain without credentials, IP addresses or a custom port.');
  url.hostname=hostname;
  return url.toString();
}

function publicIPv4(value) {
  const parts=value.split('.').map(Number);
  if(parts.length!==4 || parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b,c]=parts;
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||
    a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||
    a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}

function publicIPv6(value) {
  const v=value.toLowerCase();
  return /^[0-9a-f:]+$/.test(v) && v.includes(':') && !v.includes('.') &&
    v!=='::' && v!=='::1' && !v.startsWith('::') &&
    !/^f[cd]/.test(v) && !/^fe[89ab]/.test(v) && !/^ff/.test(v) &&
    !/^2001:db8(?::|$)/.test(v);
}

// DNS is checked at every fetch and redirect hop. Cloudflare's resolver is
// queried over HTTPS; requests do not forward user cookies or credentials.
export async function assertPublicDns(hostname, fetcher=fetch) {
  const results=await Promise.all(['A','AAAA'].map(async type=>{
    const u=new URL('https://cloudflare-dns.com/dns-query');
    u.searchParams.set('name',hostname);u.searchParams.set('type',type);
    const response=await fetcher(u,{headers:{Accept:'application/dns-json'},redirect:'manual',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('DNS lookup failed.');
    const result=await response.json();
    if(result.Status!==0)throw new Error('Domain could not be resolved.');
    return (result.Answer||[]).filter(item=>item.type===1||item.type===28);
  }));
  const answers=results.flat();
  if(!answers.length||answers.some(a=>a.type===1?!publicIPv4(a.data):!publicIPv6(a.data)))
    throw new Error('Domain must resolve only to public addresses.');
}

export async function safeFetch(input, options={}, fetcher=fetch) {
  let target=normalizeTarget(input);
  for(let i=0;i<=4;i++){
    const u=new URL(target);
    await assertPublicDns(u.hostname,fetcher);
    const response=await fetcher(target,{...options,redirect:'manual'});
    if(![301,302,303,307,308].includes(response.status))return response;
    const location=response.headers.get('location');
    await response.body?.cancel().catch(()=>{});
    if(!location||i===4)throw new Error('Redirect limit exceeded.');
    target=normalizeTarget(new URL(location,target).toString());
  }
  throw new Error('Redirect limit exceeded.');
}
