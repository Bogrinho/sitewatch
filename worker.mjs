import {transition} from './monitor.mjs';
import {sendGmail} from './smtp.mjs';
import {connect} from 'cloudflare:sockets';
import {normalizeTarget, assertPublicDns, safeFetch} from './targets.mjs';

// The online variant is deliberately fail-closed until a private access secret exists.
const json = (value, status=200) => new Response(JSON.stringify(value), {status, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const rows = async stmt => (await stmt.all()).results;
const avg = xs => xs.length ? Math.round(xs.reduce((a,b)=>a+b,0)/xs.length*100)/100 : null;
const percent = xs => xs.length ? Math.round(xs.filter(x=>x.success).length/xs.length*10000)/100 : null;
const weekStart = now => new Date(now - 7*86400000);

async function authorized(request, env) {
  if (!env.DASHBOARD_PASSWORD || !env.DASHBOARD_USER) return false;
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const value=atob(header.slice(6));
    const expected=`${env.DASHBOARD_USER}:${env.DASHBOARD_PASSWORD}`;
    const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)),
      crypto.subtle.digest('SHA-256',new TextEncoder().encode(expected))]);
    let difference=0;for(let i=0;i<32;i++)difference|=new Uint8Array(a)[i]^new Uint8Array(b)[i];
    return difference===0;
  } catch {return false;}
}
const challenge = () => new Response('Sign in to SiteWatch', {status:401,headers:{'WWW-Authenticate':'Basic realm="SiteWatch", charset="UTF-8"','Cache-Control':'no-store'}});

async function dashboard(db, period) {
  const now=new Date(), start=new Date(now.getTime()-(period==='7d'?7*86400000:86400000));
  const monitors=await rows(db.prepare('SELECT * FROM monitors WHERE active=1 ORDER BY name'));
  const checks=await rows(db.prepare('SELECT c.* FROM checks c JOIN monitors m ON m.id=c.monitor_id WHERE m.active=1 AND c.checked_at>=? AND c.checked_at<=? ORDER BY c.checked_at,c.id').bind(start.toISOString(),now.toISOString()));
  const incidents=await rows(db.prepare('SELECT i.* FROM incidents i JOIN monitors m ON m.id=i.monitor_id WHERE m.active=1 AND i.started_at<=? AND (i.resolved_at IS NULL OR i.resolved_at>=?) ORDER BY i.started_at DESC').bind(now.toISOString(),start.toISOString()));
  const data=[];
  for(const m of monitors) {
    const sample=checks.filter(c=>c.monitor_id===m.id);
    const latest=await db.prepare('SELECT * FROM checks WHERE monitor_id=? AND checked_at<=? ORDER BY checked_at DESC,id DESC LIMIT 1').bind(m.id,now.toISOString()).first();
    let selected=sample;
    if(sample.length>80) selected=Array.from({length:80},(_,i)=>sample[Math.round(i*(sample.length-1)/79)]);
    const bins=Array.from({length:48},(_,i)=>({at:new Date(start.getTime()+i*(now-start)/48).toISOString(),status:'pending'}));
    for(const c of sample){const i=Math.min(47,Math.floor((Date.parse(c.checked_at)-start.getTime())/(now-start)*48));if(i>=0)bins[i].status=!c.success?'down':bins[i].status==='down'?'down':'up';}
    data.push({id:m.id,name:m.name,url:m.url,status:m.status,response_time_ms:latest?.response_time_ms??null,
      uptime_percentage:percent(sample),ssl_days_remaining:latest?.ssl_days_remaining??null,last_checked_at:m.last_checked_at,
      consecutive_failures:m.consecutive_failures,slow_active:!!m.slow_active,slow_threshold_ms:m.slow_ms,
      sparkline:selected.map(c=>({at:c.checked_at,ms:c.response_time_ms,success:!!c.success})),uptime_bars:bins});
  }
  const mapped=incidents.map(i=>({id:i.id,monitor_id:i.monitor_id,monitor_name:monitors.find(m=>m.id===i.monitor_id)?.name||i.monitor_id,
    status:i.resolved_at?'resolved':'open',title:i.title,started_at:i.started_at,resolved_at:i.resolved_at,
    duration_seconds:Math.max(0,Math.floor(((i.resolved_at?Date.parse(i.resolved_at):now.getTime())-Date.parse(i.started_at))/1000))}));
  return {mode:'live',generated_at:now.toISOString(),check_interval_seconds:300,
    summary:{total_monitors:monitors.length,healthy_monitors:monitors.filter(m=>m.status==='up').length,
      open_incidents:mapped.filter(i=>i.status==='open').length,uptime_percentage:percent(checks),
      average_response_ms:avg(checks.filter(c=>c.success&&c.response_time_ms!==null).map(c=>c.response_time_ms))},
    monitors:data,incidents:mapped};
}

async function scan(target) {
  const start=Date.now(), response=await safeFetch(target.url,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'SiteWatch/1.0'}});
  const elapsed=Date.now()-start;
  if(response.status>=300&&response.status<400) throw Error('The site returned a redirect; open PageSpeed for a full analysis.');
  if(!response.ok) throw Error(`The website returned HTTP ${response.status}.`);
  // Bound transferred HTML, rather than downloading arbitrarily large resources.
  const reader=response.body.getReader(), chunks=[];let size=0,truncated=false;
  while(size<1048576){const next=await reader.read();if(next.done)break;const remaining=1048576-size;chunks.push(next.value.slice(0,remaining));size+=Math.min(next.value.length,remaining);if(next.value.length>remaining){truncated=true;break;}}
  await reader.cancel().catch(()=>{});
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const html=new TextDecoder().decode(bytes);
  const head=(html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)||[])[1]||'';
  const css=(head.match(/<link\b[^>]*\brel\s*=\s*["']?stylesheet\b[^>]*>/gi)||[]);
  const imgs=html.match(/<img\b[^>]*>/gi)||[];
  const missing=imgs.filter(x=>!/\bwidth\s*=/i.test(x)||!/\bheight\s*=/i.test(x));
  const classicImages=imgs.filter(x=>/\bsrc\s*=\s*["'][^"']+\.(?:png|jpe?g)(?:[?#][^"']*)?["']/i.test(x));
  const blocking=(head.match(/<script\b[^>]*\bsrc\s*=[^>]*>/gi)||[])
    .filter(x=>!/\b(?:async|defer)\b/i.test(x)&&!/\btype\s*=\s*["']module["']/i.test(x));
  const findings=[];
  if(blocking.length)findings.push({title:'Review synchronous scripts in the page head',evidence:`${blocking.length} external script(s) have no async or defer attribute.`,
    why:'These scripts can pause HTML parsing while they load and run.',how:'Check whether scripts can use defer or async without breaking functionality.',references:[]});
  if(classicImages.length)findings.push({title:'Review image formats and sizes',evidence:`${classicImages.length} PNG or JPEG image source(s) found.`,
    why:'Larger images can take longer to download; this scan does not measure their sizes.',how:'Check dimensions and compare file sizes and quality using modern formats.',references:[]});
  if(css.length)findings.push({title:'Review stylesheets loaded in the page head',evidence:`${css.length} stylesheet link(s) were found in the HTML head.`,
    why:'Stylesheets can delay the browser from showing the page while they load.',how:'Review first-screen CSS and load page-specific styles only where needed.',references:[]});
  if(missing.length)findings.push({title:'Check that images reserve layout space',evidence:`${missing.length} image element(s) lack a width or height HTML attribute.`,
    why:'Images may shift content as they load unless their size is reserved by CSS.',how:'Check the page visually and add suitable dimensions or CSS aspect-ratio where needed.',references:[]});
  return {source:'quick_scan',checked_at:new Date().toISOString(),site:target.name,url:target.url,status_code:response.status,
    response_time_ms:elapsed,html_bytes:size,truncated,findings,
    limitations:'One HTML request only. This is not Lighthouse: it does not measure LCP, run JavaScript, inspect image sizes or establish the cause of a delay.',
    pagespeed_url:`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(target.url)}`};
}

async function handler(request,env) {
  if(!await authorized(request,env))return challenge();
  const url=new URL(request.url), db=env.DB;
  if(!url.pathname.startsWith('/api/')) {
    if(url.pathname==='/'&&!url.searchParams.has('mode')) {
      url.searchParams.set('mode','live');
      return Response.redirect(url.toString(),302);
    }
    return env.ASSETS.fetch(request);
  }
  if(url.pathname==='/api/health')return json({status:'ok',service:'sitewatch-api',checker_enabled:true,check_interval_seconds:300});
  if(url.pathname==='/api/dashboard')return json(await dashboard(db,url.searchParams.get('period')==='7d'?'7d':'24h'));
  if(url.pathname==='/api/monitors' && request.method==='GET'){
    return json({monitors:await rows(db.prepare('SELECT id,name,url,active FROM monitors ORDER BY active DESC,name'))});
  }
  const monitorPath=url.pathname.match(/^\/api\/monitors\/([a-zA-Z0-9-]+)$/);
  if((url.pathname==='/api/monitors'&&request.method==='POST')||(monitorPath&&['PATCH','DELETE'].includes(request.method))){
    if(request.headers.get('origin')!==url.origin||request.headers.get('x-sitewatch')!=='settings')return json({detail:'Invalid origin'},403);
    const lockTime=new Date().toISOString(), lockUntil=new Date(Date.now()+60000).toISOString();
    const lock=await db.prepare('UPDATE cycle_lock SET lock_until=? WHERE id=1 AND lock_until<=?').bind(lockUntil,lockTime).run();
    if(!lock.meta.changes)return json({detail:'A monitoring check is in progress. Try again shortly.'},409);
    try {
      if(monitorPath){
        const id=monitorPath[1],current=await db.prepare('SELECT * FROM monitors WHERE id=?').bind(id).first();
        if(!current)return json({detail:'Monitor not found.'},404);
        if(request.method==='DELETE'){
          await db.batch([db.prepare('UPDATE monitors SET active=0 WHERE id=?').bind(id),
            db.prepare('UPDATE notifications SET cancelled_at=? WHERE monitor_id=? AND sent_at IS NULL AND cancelled_at IS NULL').bind(new Date().toISOString(),id)]);
          return json({archived:true});
        }
        const p=await request.json();
        if(typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>100)return json({detail:'Enter a name of at most 100 characters.'},422);
        if(p.active!==undefined&&typeof p.active!=='boolean')return json({detail:'Invalid status.'},422);
        if(p.url!==undefined){
          let target,previous;
          try{target=normalizeTarget(p.url);previous=normalizeTarget(current.url);}catch(e){return json({detail:e.message},422);}
          if(target!==previous){
            if(!current.active)return json({detail:'Restore this website before changing its URL.'},422);
            try{await assertPublicDns(new URL(target).hostname);}catch(e){return json({detail:e.message||'Invalid address.'},422);}
            const existing=await db.prepare('SELECT id FROM monitors WHERE url=? OR url=?').bind(target,target.endsWith('/')?target.slice(0,-1):target).first();
            if(existing)return json({detail:'This website already exists; restore it if archived.'},409);
            const replacement=crypto.randomUUID(),now=new Date().toISOString();
            await db.batch([db.prepare('UPDATE monitors SET active=0 WHERE id=?').bind(id),
              db.prepare('UPDATE notifications SET cancelled_at=? WHERE monitor_id=? AND sent_at IS NULL AND cancelled_at IS NULL').bind(now,id),
              db.prepare('INSERT INTO monitors(id,name,url,slow_ms,active) VALUES(?,?,?,?,1)').bind(replacement,p.name.trim(),target,current.slow_ms),
              db.prepare('INSERT INTO ssl_cache(monitor_id) VALUES(?)').bind(replacement)]);
            return json({saved:true,replaced:true});
          }
        }
        if(p.active&&!current.active){
          const count=await db.prepare('SELECT COUNT(*) AS n FROM monitors WHERE active=1').first();
          if(count.n>=10)return json({detail:'The workspace supports up to 10 active sites.'},422);
        }
        await db.prepare('UPDATE monitors SET name=?,active=? WHERE id=?').bind(p.name.trim(),p.active===undefined?current.active:(p.active?1:0),id).run();
        return json({saved:true});
      }
      const p=await request.json();
      if(typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>100)return json({detail:'Enter a name of at most 100 characters.'},422);
      let target;
      try{target=normalizeTarget(p.url);await assertPublicDns(new URL(target).hostname);}catch(e){return json({detail:e.message||'Invalid address.'},422);}
      const existing=await db.prepare('SELECT active FROM monitors WHERE url=? OR url=?').bind(target,target.endsWith('/')?target.slice(0,-1):target).first();
      if(existing)return json({detail:existing.active?'This website is already monitored.':'This website is archived. Restore it to keep its history.'},409);
      const count=await db.prepare('SELECT COUNT(*) AS n FROM monitors WHERE active=1').first();
      if(count.n>=10)return json({detail:'The workspace supports up to 10 active sites.'},422);
      const id=crypto.randomUUID();
      await db.batch([db.prepare('INSERT INTO monitors(id,name,url,active) VALUES(?,?,?,1)').bind(id,p.name.trim(),target),
        db.prepare('INSERT INTO ssl_cache(monitor_id) VALUES(?)').bind(id)]);
      return json({id},201);
    } finally {await db.prepare('UPDATE cycle_lock SET lock_until=? WHERE id=1 AND lock_until=?').bind('',lockUntil).run();}
  }
  if(url.pathname==='/api/weekly-report') {
    const data=await dashboard(db,'7d');
    const lines=['SiteWatch — last 7 days','Based on recorded checks; gaps are not counted as uptime.',''];
    for(const m of data.monitors){
      const stats=await db.prepare('SELECT AVG(response_time_ms) AS mean FROM checks WHERE monitor_id=? AND success=1 AND checked_at>=?').bind(m.id,weekStart(Date.now()).toISOString()).first();
      lines.push(`${m.name}: ${m.uptime_percentage===null?'no checks':m.uptime_percentage.toFixed(2)+'% successful checks'}; average response ${stats?.mean==null?'no response readings':Math.round(stats.mean)+' ms'}; status ${m.status}.`);
    }
    lines.push(`Incidents overlapping this period: ${data.incidents.length}; open: ${data.summary.open_incidents}.`);
    return json({report:lines.join('\n'),period:'last 7 days',generated_at:new Date().toISOString()});
  }
  if(url.pathname==='/api/alert-settings'){
    if(request.method==='GET'){
      const p=await db.prepare('SELECT * FROM alert_settings WHERE id=1').first(), ms=await rows(db.prepare('SELECT id,slow_ms FROM monitors WHERE active=1'));
      const pending=await db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE sent_at IS NULL AND cancelled_at IS NULL').first();
      const latest=await db.prepare('SELECT last_error FROM notifications ORDER BY id DESC LIMIT 1').first();
      return json({recipient:p.recipient,ssl_days:p.ssl_days,weekly_enabled:!!p.weekly_enabled,thresholds:Object.fromEntries(ms.map(m=>[m.id,m.slow_ms])),
        smtp_configured:!!(env.SMTP_USER&&env.SMTP_PASSWORD),pending:pending.n,latest_delivery_error:latest?.last_error??null});
    }
    if(request.method==='PUT'){
      if(request.headers.get('origin')!==url.origin||request.headers.get('x-sitewatch')!=='settings')return json({detail:'Invalid origin'},403);
      const p=await request.json(), ids=(await rows(db.prepare('SELECT id FROM monitors WHERE active=1'))).map(m=>m.id);
      if(typeof p.recipient!=='string'||p.recipient.length>254||p.recipient&&(!/^[^\s@]+@[^\s@]+$/.test(p.recipient))||!Number.isInteger(p.ssl_days)||p.ssl_days<1||p.ssl_days>90||typeof p.weekly_enabled!=='boolean'||!p.thresholds||Object.keys(p.thresholds).length!==ids.length||ids.some(id=>!Number.isInteger(p.thresholds[id])||p.thresholds[id]<100||p.thresholds[id]>60000))return json({detail:'Invalid settings'},422);
      const commands=[db.prepare('UPDATE alert_settings SET recipient=?,ssl_days=?,weekly_enabled=? WHERE id=1').bind(p.recipient,p.ssl_days,p.weekly_enabled?1:0)];
      for(const id of ids)commands.push(db.prepare('UPDATE monitors SET slow_streak=CASE WHEN slow_ms != ? THEN 0 ELSE slow_streak END,slow_active=CASE WHEN slow_ms != ? THEN 0 ELSE slow_active END,slow_ms=? WHERE id=?').bind(p.thresholds[id],p.thresholds[id],p.thresholds[id],id));
      await db.batch(commands);return json({saved:true});
    }
    return json({detail:'Method not allowed'},405);
  }
  const match=url.pathname.match(/^\/api\/monitors\/([a-zA-Z0-9-]+)\/quick-analysis$/);
  if(match){const target=await db.prepare('SELECT * FROM monitors WHERE id=? AND active=1').bind(match[1]).first();if(!target)return json({detail:'Unknown monitor'},404);try{return json(await scan(target));}catch{return json({detail:'Quick scan unavailable. Try Google PageSpeed.'},502);}}
  return json({detail:'Not found'},404);
}

async function inspectCertificate(db, monitor) {
  const cached=await db.prepare('SELECT * FROM ssl_cache WHERE monitor_id=?').bind(monitor.id).first();
  const now=Date.now();
  if(cached&&cached.next_attempt<=new Date(now).toISOString()){
    try {
      const params=new URLSearchParams({host:new URL(monitor.url).hostname,fromCache:'on',all:'on',maxAge:'24'});
      const response=await fetch('https://api.ssllabs.com/api/v3/analyze?'+params,{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error('SSL service unavailable');
      const report=await response.json();
      if((report.status==='READY'||report.status==='IN_PROGRESS')&&Array.isArray(report.certs)&&Array.isArray(report.endpoints)){
        const leaves=report.endpoints.flatMap(e=>(e.details?.certChains||[]).map(chain=>chain.certIds?.[0])).filter(Boolean);
        const expiries=report.certs.filter(c=>leaves.includes(c.id)&&Number.isFinite(c.notAfter)).map(c=>c.notAfter);
        if(expiries.length){
          const expiry=Math.min(...expiries);
          await db.prepare('UPDATE ssl_cache SET not_after=?,observed_at=?,next_attempt=? WHERE monitor_id=?')
            .bind(expiry,new Date(now).toISOString(),new Date(now+(report.status==='READY'?86400000:1200000)).toISOString(),monitor.id).run();
          return {days:Math.floor((expiry-now)/86400000),error:null};
        }
      }
      await db.prepare('UPDATE ssl_cache SET next_attempt=? WHERE monitor_id=?').bind(new Date(now+1200000).toISOString(),monitor.id).run();
    }catch {
      await db.prepare('UPDATE ssl_cache SET next_attempt=? WHERE monitor_id=?').bind(new Date(now+3600000).toISOString(),monitor.id).run();
    }
  }
  // Never present a stale certificate observation as current.
  if(cached?.not_after&&cached.observed_at&&now-Date.parse(cached.observed_at)<48*3600000)
    return {days:Math.floor((cached.not_after-now)/86400000),error:null};
  return {days:null,error:'SSL Labs certificate report is not available yet'};
}

function isoWeek(date) {
  const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  const y=d.getUTCFullYear(),first=new Date(Date.UTC(y,0,1));
  return `${y}-W${String(Math.ceil((((d-first)/86400000)+1)/7)).padStart(2,'0')}`;
}

async function deliver(env,settings) {
  if(!settings.recipient||!env.SMTP_USER||!env.SMTP_PASSWORD)return;
  const notice=await env.DB.prepare('SELECT * FROM notifications WHERE sent_at IS NULL AND cancelled_at IS NULL ORDER BY id LIMIT 1').first();
  if(!notice)return;
  try{
    await sendGmail(connect,{user:env.SMTP_USER,password:env.SMTP_PASSWORD,to:settings.recipient,subject:notice.subject,body:notice.body});
    await env.DB.prepare('UPDATE notifications SET sent_at=?,attempts=attempts+1,last_error=NULL WHERE id=?').bind(new Date().toISOString(),notice.id).run();
  }catch(error){
    console.warn('Email delivery failed:',error?.name);
    await env.DB.prepare('UPDATE notifications SET attempts=attempts+1,last_error=? WHERE id=?').bind('Email delivery failed; check SMTP settings',notice.id).run();
  }
}

export default {
  async fetch(request,env) { try{return await handler(request,env);}catch(error){console.error('SiteWatch request failed',error?.name);return json({detail:'Service unavailable'},503);} },
  async scheduled(controller,env,ctx) {ctx.waitUntil(runCycle(env));}
};

export async function runCycle(env) {
  if(!env.DB)return;
  const db=env.DB, settings=await db.prepare('SELECT * FROM alert_settings WHERE id=1').first();
  const lockTime=new Date().toISOString(), lockUntil=new Date(Date.now()+180000).toISOString();
  const lock=await db.prepare('UPDATE cycle_lock SET lock_until=? WHERE id=1 AND lock_until<=?').bind(lockUntil,lockTime).run();
  if(!lock.meta.changes)return;
  try {
  for(const monitor of await rows(db.prepare('SELECT * FROM monitors WHERE active=1'))) {
    const now=new Date().toISOString(), start=Date.now();let check;
    try {
      const response=await safeFetch(monitor.url,{signal:AbortSignal.timeout(10000),headers:{'User-Agent':'SiteWatch/1.0'}});
      await response.body?.cancel();
      check={success:response.status>=200&&response.status<400,response_time_ms:Date.now()-start,status_code:response.status,error:null,ssl_days_remaining:null,ssl_error:null};
    }catch(error){check={success:false,response_time_ms:null,status_code:null,error:'Request failed',ssl_days_remaining:null,ssl_error:'Certificate expiry check unavailable on this runtime'};}
    const certificate=await inspectCertificate(db,monitor);
    check.ssl_days_remaining=certificate.days;check.ssl_error=certificate.error;
    const update=transition(monitor,check,settings.ssl_days);
    const statements=[
      db.prepare('INSERT INTO checks(monitor_id,checked_at,success,response_time_ms,status_code,error,ssl_days_remaining,ssl_error) VALUES(?,?,?,?,?,?,?,?)').bind(monitor.id,now,check.success?1:0,check.response_time_ms,check.status_code,check.error,check.ssl_days_remaining,check.ssl_error),
      db.prepare('UPDATE monitors SET status=?,consecutive_failures=?,last_checked_at=?,slow_streak=?,slow_active=?,ssl_alerted=? WHERE id=?').bind(update.monitor.status,update.monitor.consecutive_failures,now,update.monitor.slow_streak,update.monitor.slow_active,update.monitor.ssl_alerted,monitor.id)
    ];
    if(update.incident==='open')statements.push(db.prepare('INSERT INTO incidents(id,monitor_id,title,started_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),monitor.id,`${monitor.name} is not responding successfully`,now));
    if(update.incident==='resolve')statements.push(db.prepare('UPDATE incidents SET resolved_at=? WHERE monitor_id=? AND resolved_at IS NULL').bind(now,monitor.id));
    for(const notice of update.notices)statements.push(db.prepare('INSERT INTO notifications(subject,body,created_at,monitor_id) VALUES(?,?,?,?)').bind(notice.subject,notice.body,now,monitor.id));
    await db.batch(statements);
  }
  const now=new Date(), week=isoWeek(now);
  if(settings.recipient&&settings.weekly_enabled&&env.SMTP_USER&&env.SMTP_PASSWORD&&(now.getUTCDay()!==1||now.getUTCHours()>=9)&&settings.last_week!==week){
    // Match the on-demand report, using observed checks only.
    const data=await dashboard(db,'7d'),lines=['SiteWatch — last 7 days','Based on recorded checks; gaps are not counted as uptime.',''];
    for(const m of data.monitors){
      const stats=await db.prepare('SELECT AVG(response_time_ms) AS mean FROM checks WHERE monitor_id=? AND success=1 AND checked_at>=?').bind(m.id,weekStart(Date.now()).toISOString()).first();
      lines.push(`${m.name}: ${m.uptime_percentage===null?'no checks':m.uptime_percentage.toFixed(2)+'% successful checks'}; average response ${stats?.mean==null?'no response readings':Math.round(stats.mean)+' ms'}; status ${m.status}.`);
    }
    lines.push(`Incidents overlapping this period: ${data.incidents.length}; open: ${data.summary.open_incidents}.`);
    await db.batch([db.prepare('INSERT INTO notifications(subject,body,created_at) VALUES(?,?,?)').bind('SiteWatch weekly report',lines.join('\n'),now.toISOString()),db.prepare('UPDATE alert_settings SET last_week=? WHERE id=1').bind(week)]);
  }
  await deliver(env,settings);
  } finally {
    await db.prepare('UPDATE cycle_lock SET lock_until=? WHERE id=1 AND lock_until=?').bind('',lockUntil).run();
  }
}
