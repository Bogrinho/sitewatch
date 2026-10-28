import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, CheckCircle2, ClipboardList, Globe2, Lightbulb, LoaderCircle, SearchCheck } from 'lucide-react';
import type { Mode, Monitor } from './types';

type Finding = {title:string; evidence:string; why:string; how:string; references:string[]};
type QuickReport = {source:'quick_scan'; checked_at:string; site:string; url:string; status_code:number; response_time_ms:number; html_bytes:number; truncated:boolean; findings:Finding[]; limitations:string; pagespeed_url:string};
const sites = [
  {id:'storefront',name:'Storefront',url:'https://storefront.example.com'},
  {id:'portfolio',name:'Portfolio',url:'https://portfolio.example.com'},
  {id:'company',name:'Company Site',url:'https://company.example.com'},
] as const;
type SiteId = string;
function sampleReport(id:SiteId):QuickReport {
  const site=sites.find(item=>item.id===id)||sites[0];
  return {source:'quick_scan',checked_at:new Date().toISOString(),site:site.name,url:site.url,status_code:200,response_time_ms:780,html_bytes:42000,truncated:false,
    limitations:'Illustrative sample only. A real quick scan does not measure LCP or execute JavaScript.',
    pagespeed_url:`https://pagespeed.web.dev/analysis?${new URLSearchParams({url:site.url})}`,
    findings:[{title:'Review stylesheets loaded in the page head',evidence:'Example: 6 stylesheet links found.',why:'Stylesheets can delay the first visible screen.',how:'Check which styles are needed immediately and load page-specific styles only where needed.',references:['sample-theme.css']},
      {title:'Review image formats and sizes',evidence:'Example: 3 PNG or JPEG image sources found.',why:'Larger images can take longer to download. This quick scan does not measure their size.',how:'Check dimensions and compare image quality and file size in WebP or AVIF.',references:['sample-image.png']}]};
}

export default function Insights({mode,apiBase,monitors}:{mode:Mode;apiBase:string;monitors:Monitor[]}) {
  const [siteId,setSiteId]=useState<SiteId>('');
  const [report,setReport]=useState<QuickReport|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const active=useRef<AbortController|null>(null);
  const available=mode==='demo'?sites:monitors;
  const site=available.find(item=>item.id===siteId)||available[0];
  const selectedId=site?.id||'';
  const pagespeed=site?`https://pagespeed.web.dev/analysis?${new URLSearchParams({url:site.url})}`:'#';
  useEffect(()=>{const pending=active.current;active.current=null;pending?.abort();setReport(null);setError('');setLoading(false);},[mode,selectedId,apiBase]);
  useEffect(()=>()=>{const pending=active.current;active.current=null;pending?.abort();},[]);
  async function run(){
    active.current?.abort(); setError(''); setReport(null);
    if(mode==='demo'){setReport(sampleReport(selectedId));return;}
    const controller=new AbortController(); active.current=controller; setLoading(true);
    const timer=window.setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(`${apiBase.replace(/\/$/,'')}/api/monitors/${encodeURIComponent(selectedId)}/quick-analysis`,{signal:controller.signal,headers:{Accept:'application/json'}});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.detail||`Scan failed (${response.status}).`);
      if(data?.source!=='quick_scan'||!Array.isArray(data.findings))throw new Error('The API returned an unexpected report.');
      if(active.current===controller)setReport(data as QuickReport);
    } catch(err) {
      if(active.current===controller)setError(controller.signal.aborted?'The scan timed out. Please try again.':err instanceof Error?err.message:'The scan could not be completed.');
    } finally {window.clearTimeout(timer);if(active.current===controller){active.current=null;setLoading(false);}}
  }
  return <div className="insights-layout">
    <section className="panel insights-intro">
      <div className="insights-icon"><SearchCheck size={22}/></div>
      <div><p className="eyebrow">A SMALL CHECK, WITH CLEAR NEXT STEPS</p><h2>Understand what to review.</h2><p>Inspect one page and get practical suggestions based on what the scan actually finds.</p></div>
    </section>
    <section className="panel insights-controls">
      <div><label htmlFor="insight-site">Website</label><select id="insight-site" value={selectedId} onChange={event=>setSiteId(event.target.value as SiteId)}>{available.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <button className="primary-button" onClick={run} disabled={loading||!site}>{loading?<LoaderCircle size={16} className="spin"/>:<SearchCheck size={16}/>} {loading?'Scanning…':'Run quick scan'}</button>
      <a className="secondary-button insights-external" aria-disabled={!site} href={pagespeed} target="_blank" rel="noreferrer">Open Google PageSpeed <ArrowUpRight size={15}/></a>
    </section>
    <div className="insights-notice"><AlertCircle size={18}/><p><strong>{mode==='demo'?'Sample mode: ':'A focused, lightweight check. '}</strong>{mode==='demo'?'The example findings are synthetic and do not inspect a real website.':'This is a single HTML request, not a Lighthouse test. It does not measure LCP or prove what makes the page slow.'}</p></div>
    {error&&<div className="connection-error" role="alert"><AlertCircle size={20}/><div><strong>Scan unavailable</strong><p>{error}</p><p>Check that the local backend is running, or open Google PageSpeed for a full analysis.</p></div></div>}
    {!report&&!loading&&!error&&<section className="panel insights-empty"><div className="insights-icon muted-icon"><Lightbulb size={24}/></div><h2>Start with one website.</h2><p>Choose a site and run a quick scan to see the evidence, why it matters, and what to try next.</p></section>}
    {loading&&<section className="panel insights-empty" role="status"><LoaderCircle size={28} className="spin"/><h2>Inspecting the page…</h2><p>We are checking the initial response and HTML. This can take a few seconds.</p></section>}
    {report&&<div className="insights-results">
      <section className="panel insights-result-header"><div><p className="eyebrow">{mode==='demo'?'SYNTHETIC EXAMPLE':'QUICK SCAN RESULT'}</p><h2><Globe2 size={21}/>{report.site}</h2><p>{mode==='demo'?'Illustrative results, not a measurement.':`Checked ${new Date(report.checked_at).toLocaleString()}`}</p></div><div className="insights-facts"><span><small>HTTP</small><strong>{report.status_code}</strong></span><span><small>Response</small><strong>{report.response_time_ms} ms</strong></span><span><small>HTML inspected</small><strong>{Math.round(report.html_bytes/1024)} KB{report.truncated?' (partial)':''}</strong></span></div></section>
      <div className="insights-section-title"><div><p className="eyebrow">EVIDENCE BEFORE ACTION</p><h2>{report.findings.length} {report.findings.length===1?'item':'items'} to review</h2></div><span><ClipboardList size={16}/>Potential improvements</span></div>
      {report.findings.length===0?<section className="panel insights-empty"><CheckCircle2 size={28}/><h2>No matching issues found.</h2><p>This limited scan does not guarantee that the page is fast. Run PageSpeed for a full report.</p></section>:report.findings.map((item,index)=><article className="panel finding-card" key={`${item.title}-${index}`}><div className="finding-number">{String(index+1).padStart(2,'0')}</div><div className="finding-content"><h3>{item.title}</h3><p className="finding-evidence">{item.evidence}</p><div className="finding-explanations"><div><strong>WHY IT MATTERS</strong><p>{item.why}</p></div><div><strong>WHAT TO TRY</strong><p>{item.how}</p></div></div>{item.references.length>0&&<div className="finding-references"><span>Examples</span>{item.references.map((ref,i)=><code key={`${ref}-${i}`}>{ref}</code>)}</div>}</div></article>)}
      <p className="insights-limitations">{report.limitations} {report.truncated&&'Only the first part of the HTML was inspected.'}</p>
    </div>}
  </div>;
}
