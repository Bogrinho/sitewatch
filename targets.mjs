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

// A checker fault must not be counted as evidence that the monitored site is down.
export class CheckError extends Error {
  constructor(message, code, source='checker', cause) {
    super(message, {cause});
    this.name='CheckError'; this.code=code; this.source=source;
  }
}
function reserve(budget, count) {
  if(!budget)return;
  if(!Number.isInteger(budget.remaining)||budget.remaining<count)
    throw new CheckError('Check deferred because the request budget was reached.', 'CHECKER_BUDGET');
  budget.remaining-=count;
}
function ensureActive(signal) {
  if(signal?.aborted)throw new CheckError('Check deadline expired during validation.', 'CHECK_ABORTED');
}

// DNS is checked at every fetch and redirect hop. The safety resolver shares the
// overall deadline; failure of this service is a checker fault, not a site outage.
export async function assertPublicDns(hostname, fetcher=fetch, {signal,budget,dnsTimeoutMs=5000}={}) {
  ensureActive(signal);
  reserve(budget,2);
  const results=await Promise.all(['A','AAAA'].map(async type=>{
    const u=new URL('https://cloudflare-dns.com/dns-query');
    u.searchParams.set('name',hostname);u.searchParams.set('type',type);
    const timeout=AbortSignal.timeout(dnsTimeoutMs);
    const combined=signal?AbortSignal.any([signal,timeout]):timeout;
    let result;
    try {
      const response=await fetcher(u,{headers:{Accept:'application/dns-json'},redirect:'manual',signal:combined});
      if(!response.ok)throw new CheckError('Safety DNS service returned an error.', 'DNS_SERVICE_FAILED');
      result=await response.json();
    } catch(error) {
      if(error instanceof CheckError)throw error;
      if(combined.aborted)throw new CheckError('Safety DNS lookup timed out.', 'DNS_TIMEOUT','checker',error);
      throw new CheckError('Safety DNS service could not be reached.', 'DNS_SERVICE_FAILED','checker',error);
    }
    if(result?.Status===3)throw new CheckError('Domain does not exist.', 'DNS_NOT_FOUND','target');
    if(result?.Status!==0)throw new CheckError('Safety DNS service could not resolve the domain.', 'DNS_RESOLUTION_FAILED');
    if(result.Answer!==undefined&&!Array.isArray(result.Answer))throw new CheckError('Safety DNS service returned invalid data.', 'DNS_SERVICE_FAILED');
    return (result.Answer||[]).filter(item=>item.type===1||item.type===28);
  }));
  ensureActive(signal);
  const answers=results.flat();
  if(!answers.length)throw new CheckError('Domain has no public address records.', 'DNS_NO_ADDRESS','target');
  if(answers.some(a=>typeof a.data!=='string'||(a.type===1?!publicIPv4(a.data):!publicIPv6(a.data))))
    throw new CheckError('Target resolves to a blocked or invalid address.', 'BLOCKED_TARGET');
}

export async function safeFetch(input, options={}, fetcher=fetch, clock=Date.now) {
  const {onTiming,budget,dnsTimeoutMs,...requestOptions}=options;
  let responseTimeMs=0;
  let target;
  try{target=normalizeTarget(input);}catch(error){throw new CheckError('Target URL is not permitted.', 'BLOCKED_TARGET','checker',error);}
  for(let i=0;i<=4;i++){
    ensureActive(requestOptions.signal);
    const u=new URL(target);
    await assertPublicDns(u.hostname,fetcher,{signal:requestOptions.signal,budget,dnsTimeoutMs});
    ensureActive(requestOptions.signal);
    reserve(budget,1);
    const started=clock();
    let response;
    try{response=await fetcher(target,{...requestOptions,redirect:'manual'});}catch(error){
      if(/subrequests|resource limit|cpu time|memory limit/i.test(error?.message||''))
        throw new CheckError('Checker runtime resource limit reached.', 'RESOURCE_LIMIT','checker',error);
      throw new CheckError(requestOptions.signal?.aborted?'Website response timed out.':'Website request failed.',requestOptions.signal?.aborted?'REQUEST_TIMEOUT':'TARGET_FETCH_FAILED','target',error);
    }
    responseTimeMs+=Math.max(0,clock()-started);
    if(![301,302,303,307,308].includes(response.status)){
      onTiming?.({responseTimeMs,redirects:i});
      return response;
    }
    const location=response.headers.get('location');
    await response.body?.cancel().catch(()=>{});
    if(!location||i===4)throw new CheckError('Website redirect limit exceeded or redirect has no destination.', 'REDIRECT_LIMIT','target');
    try{target=normalizeTarget(new URL(location,target).toString());}catch(error){throw new CheckError('Website redirected to a disallowed destination.', 'INVALID_REDIRECT','target',error);}
  }
  throw new CheckError('Website redirect limit exceeded.', 'REDIRECT_LIMIT','target');
}
