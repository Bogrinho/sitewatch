import {useEffect, useState, type FormEvent} from 'react';
import {Bell, Check, FileText, Mail, ShieldCheck} from 'lucide-react';
import type {Mode, Monitor} from './types';

type Preferences = {recipient:string; ssl_days:number; weekly_enabled:boolean; thresholds:Record<string,number>; smtp_configured:boolean; pending:number; latest_delivery_error:string|null};

const initial:Preferences={recipient:'',ssl_days:14,weekly_enabled:true,thresholds:{storefront:2000,portfolio:2000,company:2000},smtp_configured:false,pending:0,latest_delivery_error:null};
const demoReport='Sample report — last 7 days\n\nStorefront: 99.8% successful checks; average response 340 ms.\nPortfolio: 100% successful checks; average response 510 ms.\nCompany Site: 99.9% successful checks; average response 290 ms.\n\nDemo data only. Live reports use recorded observations.';

export function AlertSettings({mode,apiBase,monitors}:{mode:Mode;apiBase:string;monitors:Monitor[]}){
  const names=Object.fromEntries(monitors.map(m=>[m.id,m.name]));
  const [prefs,setPrefs]=useState<Preferences>(initial);
  const [message,setMessage]=useState('');
  const [ready,setReady]=useState(mode==='demo');
  useEffect(()=>{
    setMessage('');setReady(mode==='demo');setPrefs(initial);
    if(mode==='demo')return;
    let active=true;
    fetch(`${apiBase.replace(/\/$/,'')}/api/alert-settings`).then(r=>{if(!r.ok)throw Error();return r.json();})
      .then(data=>{if(active){setPrefs(data);setReady(true);}})
      .catch(()=>{if(active)setMessage('Could not load alert settings. Check the API connection.');});
    return()=>{active=false;};
  },[mode,apiBase]);
  async function save(e:FormEvent){
    e.preventDefault();setMessage('');
    if(mode==='demo'){setMessage('Demo only: changes are not saved or emailed.');return;}
    try {
      const response=await fetch(`${apiBase.replace(/\/$/,'')}/api/alert-settings`,{method:'PUT',headers:{'Content-Type':'application/json','X-SiteWatch':'settings'},body:JSON.stringify({recipient:prefs.recipient,ssl_days:prefs.ssl_days,weekly_enabled:prefs.weekly_enabled,thresholds:prefs.thresholds})});
      if(!response.ok)throw new Error('Could not save settings. Check the fields and API connection.');
      setMessage('Alert settings saved.'); 
    } catch(err){setMessage(err instanceof Error?err.message:'Could not save settings.');}
  }
  return <section className="panel alerts-panel"><div className="section-heading"><div><h2>Alerts &amp; reports</h2><p>Choose when SiteWatch should notify you.</p></div><Bell size={20}/></div>
    <div className={prefs.smtp_configured&&prefs.recipient?'alert-setup ready':'alert-setup'}><Mail size={19}/><div><strong>{mode==='demo'?'Demo settings':prefs.smtp_configured&&prefs.recipient?'Email service configured':'Email service needs setup'}</strong><p>{mode==='demo'?'Changes here are examples and do not send email.':prefs.smtp_configured&&prefs.recipient?'Notifications are sent while the monitoring backend is running.':'Save your address here, then configure SMTP on the backend. No emails are sent until SMTP is configured.'}</p>{mode==='live'&&prefs.pending>0&&<small>{prefs.pending} notification(s) waiting for delivery.</small>}{mode==='live'&&prefs.latest_delivery_error&&<small>Last delivery error: {prefs.latest_delivery_error}. Check your SMTP settings.</small>}</div></div>
    {ready&&<form onSubmit={save} className="alerts-form"><label>Email address<input type="email" value={prefs.recipient} onChange={e=>setPrefs({...prefs,recipient:e.target.value})} placeholder="you@example.com"/></label>
      <div className="threshold-heading"><strong>Slow response limits</strong><small>Alert after 3 consecutive successful checks above the limit.</small></div>
      <div className="threshold-grid">{Object.entries(names).map(([id,name])=><label key={id}>{name}<span><input type="number" min="100" max="60000" step="100" required value={prefs.thresholds[id]??''} onChange={e=>setPrefs({...prefs,thresholds:{...prefs.thresholds,[id]:Number(e.target.value)}})}/><b>ms</b></span></label>)}</div>
      <label>SSL warning before expiry<select value={prefs.ssl_days} onChange={e=>setPrefs({...prefs,ssl_days:Number(e.target.value)})}><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={60}>60 days</option></select></label>
      <label className="check-label"><input type="checkbox" checked={prefs.weekly_enabled} onChange={e=>setPrefs({...prefs,weekly_enabled:e.target.checked})}/> Send a weekly report by email <small>First available check after Monday 09:00 UTC.</small></label>
      <p className="alert-note"><ShieldCheck size={16}/> Outage alerts open after 3 failed checks and include a recovery message.</p><button className="primary-button" type="submit"><Check size={16}/>Save alert settings</button></form>}
    {message&&<p role="status" className="settings-notice">{message}</p>}
  </section>;
}

export function WeeklyReport({mode,apiBase}:{mode:Mode;apiBase:string}){
  const [report,setReport]=useState('');const [error,setError]=useState('');
  useEffect(()=>{setError('');setReport(mode==='demo'?demoReport:'');if(mode==='demo')return;let active=true;
    fetch(`${apiBase.replace(/\/$/,'')}/api/weekly-report`).then(r=>{if(!r.ok)throw Error();return r.json();})
      .then(data=>{if(active)setReport(data.report);}).catch(()=>{if(active)setError('Could not load the report. Check the monitoring API.');});
    return()=>{active=false;};
  },[mode,apiBase]);
  return <section className="panel weekly-panel"><div className="section-heading"><div><h2>Weekly report</h2><p>Availability, response times and incidents over the last 7 days.</p></div><FileText size={20}/></div>
    <p className="muted">{mode==='demo'?'Sample report using illustrative data.':'Calculated from recorded checks. Time without a check is not counted as uptime.'}</p>
    {error?<p role="alert">{error}</p>:report?<pre>{report}</pre>:<p>Preparing report…</p>}
    <p className="alert-note"><Mail size={16}/> Email delivery can be enabled in Settings after configuring SMTP.</p>
  </section>;
}
