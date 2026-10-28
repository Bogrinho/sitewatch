import {useEffect, useState, type FormEvent} from 'react';
import {Archive, Edit3, Plus, RotateCcw} from 'lucide-react';
import type {Mode} from './types';

type Entry={id:string;name:string;url:string;active:number};
export default function ManageMonitors({mode,apiBase,onChanged}:{mode:Mode;apiBase:string;onChanged:()=>void}){
  const [items,setItems]=useState<Entry[]>([]), [name,setName]=useState(''), [url,setUrl]=useState('');
  const [editing,setEditing]=useState<string|null>(null), [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const base=apiBase.replace(/\/$/,'');
  async function refresh(){
    const response=await fetch(`${base}/api/monitors`);
    if(!response.ok)throw Error('Could not load websites.');
    const data=await response.json();setItems(data.monitors);
  }
  useEffect(()=>{if(mode==='demo'){setItems([]);return;}let active=true;
    fetch(`${base}/api/monitors`).then(r=>{if(!r.ok)throw Error();return r.json();})
      .then(d=>{if(active)setItems(d.monitors);}).catch(()=>{if(active)setNotice('Could not load website settings.');});
    return()=>{active=false;};
  },[mode,base]);
  async function mutate(path:string,method:string,body?:object){
    setBusy(true);setNotice('');
    try{
      const response=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json','X-SiteWatch':'settings'},body:body?JSON.stringify(body):undefined});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.detail||'Could not save changes.');
      await refresh();onChanged();return true;
    }catch(e){setNotice(e instanceof Error?e.message:'Could not save changes.');return false;}
    finally{setBusy(false);}
  }
  async function submit(e:FormEvent){
    e.preventDefault();
    if(mode==='demo'){setNotice('Demo mode does not change your real monitors. Switch to Live.');return;}
    const ok=editing?await mutate(`/api/monitors/${editing}`,'PATCH',{name,url}):await mutate('/api/monitors','POST',{name,url});
    if(ok){setName('');setUrl('');setEditing(null);setNotice(editing?'Website name updated.':'Website added. The first check may take up to five minutes.');}
  }
  return <section className="panel monitor-management"><div className="section-heading"><div><h2>Manage websites</h2><p>Add up to 10 public HTTPS websites. Archived sites keep their history.</p></div><Plus size={20}/></div>
    <form onSubmit={submit} className="monitor-form">
      <label>Website name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="My website"/></label>
      <label>Website URL<input required type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com"/></label>
      <div className="monitor-form-actions"><button className="primary-button" type="submit" disabled={busy}>{editing?'Save changes':'Add website'}</button>{editing&&<button type="button" className="secondary-button" onClick={()=>{setEditing(null);setName('');setUrl('');}}>Cancel</button>}</div>
    </form>
    {editing&&<p className="manage-notice">Changing the URL archives the old site and starts a separate history for the new address.</p>}
    {notice&&<p className="manage-notice" role="status">{notice}</p>}
    {mode==='live'&&items.length>0&&<div className="manage-list">{items.map(item=><div className="manage-item" key={item.id}><div><strong>{item.name}</strong><small>{item.url}{!item.active?' · Archived':''}</small></div><div>
      {!!item.active&&<button className="secondary-button" disabled={busy} onClick={()=>{setEditing(item.id);setName(item.name);setUrl(item.url);}} aria-label={`Edit ${item.name}`}><Edit3 size={14}/>Edit</button>}
      <button className="secondary-button" disabled={busy} onClick={async()=>{if(item.active&&!window.confirm(`Archive ${item.name}? Monitoring stops, but history is kept and can be restored.`))return;const ok=item.active?await mutate(`/api/monitors/${item.id}`,'DELETE'):await mutate(`/api/monitors/${item.id}`,'PATCH',{name:item.name,active:true});if(ok)setNotice(item.active?'Website archived. Its history is retained.':'Website restored.');}}>{item.active?<><Archive size={14}/>Archive</>:<><RotateCcw size={14}/>Restore</>}</button>
    </div></div>)}</div>}
  </section>;
}
