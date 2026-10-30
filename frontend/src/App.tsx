import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowUpRight, Check, CheckCircle2, ChevronRight, Clock3, ExternalLink, FileText, Globe2, LayoutDashboard, Lightbulb, Menu, Radio, RefreshCw, Search, Server, Settings2, ShieldCheck, TriangleAlert, WifiOff, X } from 'lucide-react';
import { createDemo } from './demo';
import Insights from './Insights';
import ManageMonitors from './ManageMonitors';
import {AlertSettings, WeeklyReport} from './Alerts';
import type { Dashboard, Incident, Mode, Monitor, MonitorStatus, Period, Scenario } from './types';

type View='overview'|'monitors'|'incidents'|'insights'|'reports'|'settings';
const viewNames:Record<View,string>={overview:'Overview',monitors:'Monitors',incidents:'Incidents',insights:'Insights',reports:'Reports',settings:'Settings'};
const statusNames:Record<MonitorStatus,string>={up:'Operational',degraded:'Degraded',down:'Unavailable',pending:'Awaiting checks',unknown:'No current data'};
const responseDefinition='HTTP time through response headers, including redirects. Safety DNS checks are excluded. This is not full page load time.';
const icons={overview:LayoutDashboard,monitors:Radio,incidents:TriangleAlert,insights:Lightbulb,reports:FileText,settings:Settings2};
const percent=(n:number|null)=>n===null?'—':`${n.toFixed(2)}%`;
const ms=(n:number|null)=>n===null?'—':`${Math.round(n)} ms`;
const time=(v:string|null)=>v?new Date(v).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'Not checked yet';
const date=(v:string)=>new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const duration=(seconds:number)=>seconds<60?`${Math.max(1,Math.round(seconds))}s`:seconds<3600?`${Math.floor(seconds/60)}m ${Math.floor(seconds%60)}s`:`${Math.floor(seconds/3600)}h ${Math.floor(seconds/60)%60}m`;
function stored(key:string){try{return localStorage.getItem(key)||'';}catch{return '';}}
const publicDemo = import.meta.env.VITE_PUBLIC_DEMO === 'true';
function initialMode():Mode {if(publicDemo)return 'demo';const query=new URLSearchParams(window.location.search).get('mode');return query==='demo'||query==='live'?query:import.meta.env.DEV?'live':'demo';}
function Status({status}:{status:MonitorStatus}){return <span className={`status status-${status}`}><span className="status-dot"/>{statusNames[status]}</span>;}

function ResponseChart({monitors,period,compact=false}:{monitors:Monitor[];period:Period;compact?:boolean}){
  const chartRef=useRef<HTMLDivElement>(null);
  const [measuredWidth,setMeasuredWidth]=useState(480);
  useEffect(()=>{
    const element=chartRef.current;
    if(!element)return;
    const measure=()=>{
      const style=window.getComputedStyle(element);
      const contentWidth=element.clientWidth-parseFloat(style.paddingLeft||'0')-parseFloat(style.paddingRight||'0');
      setMeasuredWidth(Math.max(280,Math.floor(contentWidth)));
    };
    measure();
    if(typeof ResizeObserver==='undefined'){
      window.addEventListener('resize',measure);
      return()=>window.removeEventListener('resize',measure);
    }
    const observer=new ResizeObserver(entries=>{
      const contentWidth=entries[0]?.contentRect.width;
      if(contentWidth)setMeasuredWidth(Math.max(280,Math.floor(contentWidth)));
    });
    observer.observe(element);
    return()=>observer.disconnect();
  },[]);
  const series=useMemo(()=>{
    const grouped=new Map<number,number[]>();
    monitors.flatMap(m=>m.sparkline).forEach(p=>{const key=Math.round(new Date(p.at).getTime()/300000)*300000;const bucket=grouped.get(key)||[];if(p.success&&p.ms!==null)bucket.push(p.ms);grouped.set(key,bucket);});
    const all=[...grouped.entries()].sort((a,b)=>a[0]-b[0]).map(([at,values])=>({at,value:values.length?values.reduce((a,b)=>a+b,0)/values.length:null}));
    if(all.length<=100)return all;
    return all.filter((_,i)=>i%Math.ceil(all.length/100)===0||i===all.length-1);
  },[monitors]);
  const width=measuredWidth,height=compact?200:220,left=44,right=18,top=18,bottom=35;
  const horizontalTicks=width<480?[0,.5,1]:[0,.25,.5,.75,1];
  const values=series.map(p=>p.value).filter((v):v is number=>v!==null);
  const maximum=Math.max(200,Math.ceil(Math.max(...values,0)/100)*100);
  const y=(v:number)=>top+(height-top-bottom)*(1-v/maximum);
  const x=(i:number)=>left+(width-left-right)*i/Math.max(1,series.length-1);
  let previous=false;
  const path=series.map((p,i)=>{if(p.value===null){previous=false;return '';}const segment=`${previous?'L':'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;previous=true;return segment;}).join(' ');
  return <div ref={chartRef} className="response-chart">{!series.length?<div className="chart-empty"><Activity size={28}/><strong>Your first readings will appear here</strong><span>Response times are recorded when a check succeeds.</span></div>:<svg width={width} height={height} style={{height}} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Successful response times over the last ${period==='24h'?'24 hours':'7 days'}, in milliseconds`}>
    {[0,.25,.5,.75,1].map(f=><g key={f}><line x1={left} x2={width-right} y1={y(maximum*f)} y2={y(maximum*f)} stroke="#e8ece6" strokeDasharray="3 5"/><text x={left-12} y={y(maximum*f)+4} textAnchor="end" className="axis-label">{Math.round(maximum*f)}</text></g>)}
    <path d={path} fill="none" stroke="#19856a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    {series.map((p,i)=>p.value!==null?<circle key={p.at} cx={x(i)} cy={y(p.value)} r="5" className="chart-point"><title>{new Date(p.at).toLocaleString()}: {Math.round(p.value)} ms</title></circle>:null)}
    {horizontalTicks.map(f=>{const idx=Math.min(series.length-1,Math.round((series.length-1)*f));return <text key={f} x={x(idx)} y={height-7} textAnchor={f===0?'start':f===1?'end':'middle'} className="axis-label">{new Date(series[idx].at).toLocaleString([],period==='24h'?{hour:'2-digit',minute:'2-digit'}:{month:'short',day:'numeric'})}</text>;})}
  </svg>}</div>;
}
function MiniLine({monitor}:{monitor:Monitor}){
  const points=monitor.sparkline.filter(p=>p.success&&p.ms!==null).slice(-24);
  if(points.length<2)return <span className="mini-pending">No trend yet</span>;
  const min=Math.min(...points.map(p=>p.ms!)),max=Math.max(...points.map(p=>p.ms!));
  const d=points.map((p,i)=>`${i?'L':'M'}${i*86/(points.length-1)},${24-(p.ms!-min)/(max-min||1)*18}`).join(' ');
  return <svg className="mini-line" viewBox="0 0 90 30" aria-label="Recent successful response trend" role="img"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
}
function UptimeBars({monitor}:{monitor:Monitor}){
  const bars=monitor.uptime_bars.slice(-56);
  return <div className="uptime-bars" aria-label={`${monitor.name} availability history`}>{bars.length?bars.map((b,i)=><span key={`${b.at}-${i}`} className={`bar-${b.status}`} title={`${date(b.at)} · ${b.status==='up'?'Successful check':b.status==='down'?'Failed check':'No check'}`}/>):Array.from({length:32},(_,i)=><span key={i} className="bar-pending"/>)}</div>;
}
function MonitorRows({monitors,onSelect}:{monitors:Monitor[];onSelect:(id:string)=>void}){
  return <div className="monitor-table"><div className="monitor-columns"><span>Website</span><span>Status</span><span title={responseDefinition}>HTTP response</span><span>Availability</span><span>SSL certificate</span><span/></div>{monitors.map(m=><button key={m.id} className="monitor-row" onClick={()=>onSelect(m.id)} aria-label={`View ${m.name} details`}>
    <span className="site-identity"><span className="site-icon"><Globe2 size={19}/></span><span><strong>{m.name}</strong><small>{new URL(m.url).hostname}</small></span></span>
    <span title={m.observation_error||undefined}><Status status={m.status}/></span><span className="response-cell"><strong>{ms(m.response_time_ms)}</strong>{m.slow_active?<small className="slow-label" title={`Three checks exceeded ${m.slow_threshold_ms} ms`}>Slow</small>:<MiniLine monitor={m}/>}</span>
    <span className="availability-cell"><strong>{percent(m.uptime_percentage)}</strong><UptimeBars monitor={m}/></span>
    <span className={`ssl-cell ${m.ssl_days_remaining!==null&&m.ssl_days_remaining<14?'ssl-warning':''}`}><ShieldCheck size={15}/>{m.ssl_days_remaining===null?'Not available':m.ssl_days_remaining<0?'Expired':`${m.ssl_days_remaining} days left`}</span><ChevronRight size={17} className="row-arrow"/>
  </button>)}</div>;
}
function IncidentRows({incidents,onSelect}:{incidents:Incident[];onSelect?:(id:string)=>void}){
  if(!incidents.length)return <div className="empty-state small"><CheckCircle2 size={28}/><strong>No incidents in this period</strong><p>When repeated checks fail, an incident will appear here.</p></div>;
  const Row=onSelect?'button':'div';
  return <div className="incident-list">{incidents.map(incident=><Row className="incident-row" key={incident.id} onClick={onSelect?()=>onSelect(incident.monitor_id):undefined}>
    <span className={`incident-icon ${incident.status}`} >{incident.status==='open'?<TriangleAlert size={18}/>:<Check size={18}/>}</span>
    <span className="incident-title"><strong>{incident.title}</strong><small>{incident.monitor_name} <span>·</span> {date(incident.started_at)}</small></span>
    <span className="incident-duration"><Clock3 size={13}/>{duration(incident.duration_seconds)}</span><span className={`incident-state ${incident.status}`}>{incident.status==='open'?'Open':'Resolved'}</span>{onSelect&&<ChevronRight size={16}/>}
  </Row>)}</div>;
}
function MonitorDetail({monitor,incidents,period,mode,onClose,onSimulate,onRecover}:{monitor:Monitor;incidents:Incident[];period:Period;mode:Mode;onClose:()=>void;onSimulate:(id:string)=>void;onRecover:()=>void}){
  const closeRef=useRef<HTMLButtonElement>(null);
  const modalRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const listener=(e:KeyboardEvent)=>{
      if(e.key==='Escape')onClose();
      if(e.key==='Tab'){
        const controls=Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select,[tabindex="0"]')||[]);
        const first=controls[0],last=controls[controls.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',listener);const original=document.body.style.overflow;document.body.style.overflow='hidden';closeRef.current?.focus();
    return()=>{document.removeEventListener('keydown',listener);document.body.style.overflow=original;previous?.focus();};
  },[onClose]);
  return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={modalRef} className="monitor-modal" role="dialog" aria-modal="true" aria-labelledby="monitor-title">
    <header><div className="site-icon large"><Globe2 size={24}/></div><div><p className="eyebrow">MONITOR DETAILS</p><h2 id="monitor-title">{monitor.name}</h2></div><button className="icon-button modal-close" ref={closeRef} onClick={onClose} aria-label="Close monitor details"><X size={21}/></button></header>
    <div className="detail-status"><Status status={monitor.status}/><a href={monitor.url} target="_blank" rel="noreferrer">Visit website <ExternalLink size={13}/></a></div>
    <div className="detail-metrics"><div title={responseDefinition}><span>HTTP response time</span><strong>{ms(monitor.response_time_ms)}</strong></div><div><span>Availability</span><strong>{percent(monitor.uptime_percentage)}</strong></div><div><span>SSL expiration</span><strong>{monitor.ssl_days_remaining===null?'—':`${monitor.ssl_days_remaining} days`}</strong></div></div>
    {monitor.status==='unknown'&&<p className="observation-notice" role="status">{monitor.observation_error||'No recent reliable observation is available. The website status is unknown.'}</p>}
    <p className="response-definition">{responseDefinition}</p>
    <div className="detail-chart"><div className="section-heading"><h3>Response history</h3><span>{period==='24h'?'Last 24 hours':'Last 7 days'}</span></div><ResponseChart monitors={[monitor]} period={period} compact/></div>
    <div className="detail-check-info"><span>Last checked <strong>{monitor.last_checked_at?date(monitor.last_checked_at):'Awaiting first check'}</strong></span><span>Consecutive failures <strong>{monitor.consecutive_failures}</strong></span></div>
    <div className="detail-incidents"><h3>Incident history</h3><IncidentRows incidents={incidents.filter(i=>i.monitor_id===monitor.id)} /></div>
    {mode==='demo'&&<footer><p><span className="demo-dot"/>Sample workspace · simulations affect demo data only</p>{monitor.status==='down'?<button className="primary-button" onClick={onRecover}><CheckCircle2 size={16}/>Restore service</button>:<button className="secondary-button" onClick={()=>onSimulate(monitor.id)}><TriangleAlert size={15}/>Simulate outage</button>}</footer>}
  </section></div>;
}

export default function App(){
  const [view,setView]=useState<View>('overview');
  const [mode,setMode]=useState<Mode>(initialMode);
  const [period,setPeriod]=useState<Period>('24h');
  const [scenario,setScenario]=useState<Scenario|null>(null);
  const [revision,setRevision]=useState(0);
  const [apiBase,setApiBase]=useState(()=>stored('sitewatch-api-base'));
  const [draftBase,setDraftBase]=useState(apiBase);
  const [settingsNotice,setSettingsNotice]=useState('');
  const [data,setData]=useState<Dashboard|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState('all');
  const [incidentFilter,setIncidentFilter]=useState('all');
  const [selected,setSelected]=useState<string|null>(null);
  const [mobileMenu,setMobileMenu]=useState(false);
  const demo=useMemo(()=>createDemo(period,scenario),[period,scenario,revision]);
  useEffect(()=>{
    if(mode==='demo'){setData(null);setError('');setLoading(false);return;}
    let active=true;const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
    setLoading(true);setError('');
    fetch(`${apiBase.replace(/\/$/,'')}/api/dashboard?period=${period}`,{signal:controller.signal,headers:{Accept:'application/json'}})
      .then(async response=>{if(!response.ok)throw new Error(`API returned ${response.status}`);const payload=await response.json();if(!payload.summary||!Array.isArray(payload.monitors)||!Array.isArray(payload.incidents))throw new Error('Unexpected dashboard response');if(active){setData(payload);setError('');}})
      .catch(e=>{if(active)setError('We could not reach the monitoring API. Check your connection settings and try again.');})
      .finally(()=>{clearTimeout(timeout);if(active)setLoading(false);});
    return()=>{active=false;clearTimeout(timeout);controller.abort();};
  },[mode,period,apiBase,revision]);
  useEffect(()=>{if(mode!=='live')return;const timer=setInterval(()=>setRevision(v=>v+1),60000);return()=>clearInterval(timer);},[mode]);
  const dashboard=mode==='demo'?demo:data;
  const closeDetail=useCallback(()=>setSelected(null),[]);
  const activeMonitor=dashboard?.monitors.find(m=>m.id===selected);
  const filtered=dashboard?.monitors.filter(m=>(m.name.toLowerCase().includes(search.toLowerCase())||m.url.toLowerCase().includes(search.toLowerCase()))&&(filter==='all'||m.status===filter))||[];
  const incidentList=dashboard?.incidents.filter(i=>incidentFilter==='all'||i.status===incidentFilter)||[];
  const simulate=(id?:string)=>{if(mode!=='demo')return;setScenario({monitorId:id||demo.monitors[0].id,startedAt:new Date().toISOString(),resolvedAt:null});};
  const recover=()=>setScenario(current=>current?{...current,resolvedAt:new Date().toISOString()}:null);
  const navigate=(next:View)=>{setView(next);setMobileMenu(false);};
  const switchMode=(next:Mode)=>{if(publicDemo)return;setMode(next);setSelected(null);};
  function saveSettings(e:FormEvent){e.preventDefault();let cleaned=draftBase.trim().replace(/\/$/,'');if(cleaned){try{const url=new URL(cleaned);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error();cleaned=url.origin+url.pathname.replace(/\/$/,'');}catch{setSettingsNotice('Enter a valid HTTP or HTTPS API address without credentials or query parameters.');return;}}try{localStorage.setItem('sitewatch-api-base',cleaned);}catch{/* Connection remains usable for this session. */}setApiBase(cleaned);setDraftBase(cleaned);setSettingsNotice('Connection saved. Your settings stay in this browser.');setRevision(n=>n+1);}
  const hasIssue=dashboard?.monitors.some(m=>m.status==='down'||m.status==='degraded');
  const hasPending=dashboard?.monitors.some(m=>m.status==='pending');
  const unknownCount=dashboard?.monitors.filter(m=>m.status==='unknown').length||0;
  const observationTimes=dashboard?.monitors.map(m=>m.last_checked_at).filter((at):at is string=>!!at&&Number.isFinite(Date.parse(at)))||[];
  const latestObservation=observationTimes.length?observationTimes.reduce((a,b)=>Date.parse(a)>Date.parse(b)?a:b):null;
  const headline=!dashboard?'Connecting to your workspace':dashboard.monitors.length===0?'No websites yet':unknownCount?'Monitoring data is incomplete':hasIssue?'A little attention is needed':hasPending?'Waiting for the first checks':'All systems operational';
  return <div className="app-shell">
    {mobileMenu&&<button className="sidebar-scrim" onClick={()=>setMobileMenu(false)} aria-label="Close navigation"/>}
    <aside className={`sidebar ${mobileMenu?'is-open':''}`}>
      <a className="brand" href="#" onClick={e=>{e.preventDefault();navigate('overview');}} aria-label="SiteWatch overview"><span className="brand-symbol"><Activity size={24}/></span><span>sitewatch<span className="brand-period">.</span></span></a>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">{(Object.keys(viewNames) as View[]).map(key=>{const Icon=icons[key];return <button key={key} onClick={()=>navigate(key)} className={`nav-link ${view===key?'active':''}`} aria-current={view===key?'page':undefined}><Icon size={19}/><span>{viewNames[key]}</span>{key==='incidents'&&!!dashboard?.summary.open_incidents&&<span className="nav-count">{dashboard.summary.open_incidents}</span>}</button>;})}</nav>
      <div className="sidebar-summary"><div className="sidebar-summary-icon"><Server size={18}/></div><strong>Small checks.<br/>A clearer picture.</strong><p>Keep your websites<br/>in good company.</p><div className="mini-sites"><span>W</span><span>W</span><span>T</span><small>{dashboard?.monitors.length ?? 0} websites</small></div></div>
      <div className="sidebar-bottom"><div className="avatar">SW</div><span><strong>SiteWatch Demo</strong><small>Personal workspace</small></span><span className="workspace-online" title="Personal workspace"/></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={()=>setMobileMenu(v=>!v)} aria-label="Toggle navigation" aria-expanded={mobileMenu}><Menu size={20}/></button><span>Workspace</span><ChevronRight size={13}/><strong>{viewNames[view]}</strong></div><div className="topbar-actions"><span className={`mode-label ${mode}`}><span/>{mode==='demo'?'Demo data':'Live data'}</span>{!publicDemo&&<div className="mode-switch" aria-label="Data source">{(['demo','live'] as Mode[]).map(m=><button key={m} aria-pressed={mode===m} className={mode===m?'selected':''} onClick={()=>switchMode(m)}>{m==='demo'?'Demo':'Live'}</button>)}</div>}<span className="top-avatar" title="SiteWatch Demo">SW</span></div></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">WEBSITE HEALTH, AT A GLANCE</p><h1>{view==='overview'?'Your websites. In the clear.':viewNames[view]}</h1><p className="page-description">{view==='overview'?'A little peace of mind for every website you look after.':view==='monitors'?'Availability, response times, and certificates in one place.':view==='incidents'?'A clear record of interruptions and recoveries.':view==='insights'?'Find potential improvements and understand the next steps.':view==='reports'?'A weekly view of your website health.':'Choose how this workspace connects to your monitoring service.'}</p></div><div className="page-actions">{view!=='settings'&&view!=='insights'&&view!=='reports'&&<><div className="period-switch" aria-label="History period"><button className={period==='24h'?'selected':''} aria-pressed={period==='24h'} onClick={()=>setPeriod('24h')}>24 hours</button><button className={period==='7d'?'selected':''} aria-pressed={period==='7d'} onClick={()=>setPeriod('7d')}>7 days</button></div><button className="secondary-button refresh-button" onClick={()=>setRevision(n=>n+1)} disabled={loading}><RefreshCw size={15} className={loading?'spin':''}/><span>Refresh</span></button></>}</div></div>
        {mode==='demo'&&<div className="demo-banner"><span className="demo-banner-copy"><span className="demo-dot"/><strong>A workspace to explore.</strong><span>These are sample readings, not live website checks.</span></span><button onClick={()=>scenario&&!scenario.resolvedAt?recover():simulate()} className="text-button">{scenario&&!scenario.resolvedAt?'Restore service':'Simulate an outage'}<ArrowUpRight size={14}/></button></div>}
        {error&&mode==='live'&&view!=='settings'&&view!=='insights'&&<div className="connection-error" role="alert"><WifiOff size={22}/><div><strong>Monitoring API is unavailable</strong><p>{error}{dashboard?' Showing the last successfully fetched readings.':''}</p></div><button className="secondary-button" onClick={()=>navigate('settings')}>Connection settings</button><button className="text-button" onClick={()=>switchMode('demo')}>Explore demo</button></div>}
        {view==='insights'?<Insights mode={mode} apiBase={apiBase} monitors={dashboard?.monitors||[]}/>:view==='reports'?<WeeklyReport mode={mode} apiBase={apiBase}/>:view==='settings'?<section className="settings-grid"><AlertSettings mode={mode} apiBase={apiBase} monitors={dashboard?.monitors||[]}/>{!publicDemo&&<div className="panel connection-panel"><div className="section-heading"><h2>Data connection</h2><Server size={19}/></div><p className="muted">Live mode reads the observations collected by your SiteWatch API. Demo mode uses clearly labeled sample data.</p><form onSubmit={saveSettings}><label htmlFor="api-base">API address</label><input id="api-base" type="text" value={draftBase} onChange={e=>{setDraftBase(e.target.value);setSettingsNotice('');}} placeholder="Same origin, or https://your-api.example.com" spellCheck={false}/><small>Leave empty when the dashboard and API share an address.</small><button className="primary-button" type="submit"><Check size={16}/>Save connection</button>{settingsNotice&&<p className="settings-notice" role="status">{settingsNotice}</p>}</form></div>}<div className="panel settings-about"><p className="eyebrow">HOW IT WORKS</p><h2>Observe. Record. Recover.</h2><div><Clock3 size={19}/><span><strong>Scheduled checks</strong><p>Availability checks run every {Math.round((dashboard?.check_interval_seconds||300)/60)} minutes in the backend.</p></span></div><div><TriangleAlert size={19}/><span><strong>Fewer false alarms</strong><p>An incident opens after three consecutive failures and resolves after a successful check.</p></span></div><div><ShieldCheck size={19}/><span><strong>Certificate visibility</strong><p>Track SSL expiration alongside availability. Missing certificate data is shown explicitly.</p></span></div>{mode==='demo'&&<button className="secondary-button" onClick={()=>{setScenario(null);setSettingsNotice('Sample workspace reset.');}}>Reset demo workspace</button>}</div></section>:!dashboard?<div className="loading-panel" role="status"><div className="loading-mark"><Activity size={30} className={loading?'pulse':''}/></div><h2>{loading?'Connecting to SiteWatch':'Ready when your API is'}</h2><p>{loading?'Fetching your latest website observations.':'Connect your monitoring service, or explore a sample workspace.'}</p>{!loading&&<button className="primary-button" onClick={()=>switchMode('demo')}>Explore demo workspace<ArrowUpRight size={16}/></button>}</div>:<>
        {view==='overview'&&<><section className={`health-strip ${hasIssue||unknownCount?'has-issue':''}`}><div className="health-icon">{unknownCount?<WifiOff size={20}/>:hasIssue?<TriangleAlert size={20}/>:hasPending?<Clock3 size={20}/>:<CheckCircle2 size={20}/>}</div><div><strong>{headline}</strong><p>{dashboard.monitors.length===0?'Add a website in Monitors to start checking.':unknownCount?`${unknownCount} website(s) have no recent reliable observation. Current availability is unknown for those sites.`:hasPending?'Real history begins when the checker completes its first cycle.':`${dashboard.summary.healthy_monitors} of ${dashboard.summary.total_monitors} websites are operational. ${dashboard.summary.open_incidents?'We are keeping an eye on the rest.':'Everything is looking good.'}`}</p></div><span className="last-updated"><span/>{mode==='demo'?`Sample at ${time(dashboard.generated_at)}`:`Latest check ${latestObservation?date(latestObservation):'not available'}`}</span></section>
        <section className="metrics-grid" aria-label="Monitoring summary"><div className="metric-card"><div><span>Monitors</span><Radio size={17}/></div><strong>{dashboard.summary.total_monitors}<small>websites</small></strong><p><span className="tiny-dot"/>{dashboard.summary.healthy_monitors} operational</p></div><div className="metric-card"><div><span>Availability</span><Activity size={17}/></div><strong>{percent(dashboard.summary.uptime_percentage)}</strong><p>Successful checks · {period==='24h'?'last 24 hours':'last 7 days'}</p></div><div className="metric-card" title={responseDefinition}><div><span>Avg. HTTP response</span><Clock3 size={17}/></div><strong>{dashboard.summary.average_response_ms===null?'—':Math.round(dashboard.summary.average_response_ms)}<small>{dashboard.summary.average_response_ms!==null?'ms':''}</small></strong><p>Through headers · successful checks</p></div><div className="metric-card"><div><span>Open incidents</span><TriangleAlert size={17}/></div><strong>{dashboard.summary.open_incidents}<small>active</small></strong><p>{dashboard.summary.open_incidents?'Attention needed':'No interruptions right now'}</p></div></section>
        <section className="panel chart-panel"><div className="section-heading"><div><h2>HTTP response time</h2><p>{responseDefinition}</p></div><span className="chart-legend"><span/>Mean successful response <small>ms</small></span></div><ResponseChart monitors={dashboard.monitors} period={period}/></section>
        <section className="panel monitors-panel"><div className="section-heading"><div><h2>Your monitors <span className="count-label">{dashboard.monitors.length}</span></h2><p>A quick pulse check on the websites that matter.</p></div><button className="text-button" onClick={()=>navigate('monitors')}>View all monitors<ArrowUpRight size={14}/></button></div><MonitorRows monitors={dashboard.monitors} onSelect={setSelected}/></section>
        <section className="panel"><div className="section-heading"><div><h2>Recent incidents</h2><p>From first signal to back in business.</p></div><button className="text-button" onClick={()=>navigate('incidents')}>View history<ArrowUpRight size={14}/></button></div><IncidentRows incidents={dashboard.incidents.slice(0,3)} onSelect={setSelected}/></section></>}
        {view==='monitors'&&<><ManageMonitors mode={mode} apiBase={apiBase} onChanged={()=>setRevision(n=>n+1)}/><section className="panel monitors-panel"><div className="monitor-toolbar"><label className="search-field"><Search size={17}/><input aria-label="Search monitors" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search your websites..."/></label><select aria-label="Filter monitor status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option><option value="up">Operational</option><option value="degraded">Degraded</option><option value="down">Unavailable</option><option value="pending">Awaiting checks</option><option value="unknown">No current data</option></select></div>{filtered.length?<MonitorRows monitors={filtered} onSelect={setSelected}/>:<div className="empty-state"><Search size={30}/><h2>No matching monitors</h2><p>Try another website name or status.</p><button className="text-button" onClick={()=>{setSearch('');setFilter('all');}}>Clear filters</button></div>}<div className="table-footnote"><span className="tiny-dot"/>{filtered.length} of {dashboard.monitors.length} monitors shown<span>Checks every {Math.round(dashboard.check_interval_seconds/60)} min</span></div></section></>}
        {view==='incidents'&&<section className="panel"><div className="incident-toolbar"><h2>Incident history <span className="count-label">{dashboard.incidents.length}</span></h2><div className="period-switch">{['all','open','resolved'].map(f=><button key={f} aria-pressed={incidentFilter===f} className={incidentFilter===f?'selected':''} onClick={()=>setIncidentFilter(f)}>{f[0].toUpperCase()+f.slice(1)}</button>)}</div></div><IncidentRows incidents={incidentList} onSelect={setSelected}/><div className="table-footnote">{mode==='demo'?'Sample incidents for exploring failure and recovery.':'Incidents begin after three consecutive failed checks.'}<span>{period==='24h'?'Last 24 hours':'Last 7 days'}</span></div></section>}
        </>}
        <footer className="page-footer"><span><Activity size={13}/>SiteWatch <span>·</span> Built for a clearer view.</span><span>{mode==='demo'?'Sample workspace':'Availability monitoring'}<span className="footer-dot"/></span></footer>
      </main>
    </div>
    {activeMonitor&&dashboard&&<MonitorDetail monitor={activeMonitor} incidents={dashboard.incidents} period={period} mode={mode} onClose={closeDetail} onSimulate={simulate} onRecover={recover}/>}
  </div>;
}
