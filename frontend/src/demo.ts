import type { CheckPoint, Dashboard, Monitor, Period, Scenario } from './types';

// Deliberate sample observations. No network checks or production records are used here.
const intervalSeconds = 300;
const intervalMs = intervalSeconds * 1000;
const targets = [
  {id:'storefront',name:'Storefront',url:'https://storefront.example.com',baseline:238,ssl:68},
  {id:'portfolio',name:'Portfolio',url:'https://portfolio.example.com',baseline:312,ssl:84},
  {id:'company',name:'Company Site',url:'https://company.example.com',baseline:196,ssl:52},
];
const iso = (timestamp:number) => new Date(timestamp).toISOString();
const roundedPercentage = (successes:number,total:number) => total ? Number((successes / total * 100).toFixed(2)) : null;

/** The optional clock makes the demo's observation and incident chronology reproducible. */
export function createDemo(period: Period, scenario: Scenario | null, now = Date.now()): Dashboard {
  const latestRegular = Math.floor(now / intervalMs) * intervalMs;
  const windowMs = (period === '24h' ? 24 : 168) * 3600000;
  const windowStart = now - windowMs;
  const sampleIncidentOpened = latestRegular - 17 * 3600000;
  const sampleIncidentRecovered = sampleIncidentOpened + intervalMs;
  const scenarioOpened = scenario ? Date.parse(scenario.startedAt) : null;
  const scenarioRecovered = scenario?.resolvedAt ? Date.parse(scenario.resolvedAt) : null;

  const monitors: Monitor[] = targets.map((target, index) => {
    const responseAt = (at:number) => {
      const tick = Math.floor(at / intervalMs);
      return Math.round(target.baseline + Math.sin(tick * .72 + index) * 35 + Math.cos(tick * .23) * 21);
    };
    const byTime = new Map<number,CheckPoint>();
    for(let at = latestRegular - windowMs + intervalMs; at <= latestRegular; at += intervalMs){
      if(at < windowStart) continue;
      const failed = index === 1 && at >= sampleIncidentOpened - 2 * intervalMs && at < sampleIncidentRecovered;
      byTime.set(at,{at:iso(at),ms:failed ? null : responseAt(at),success:!failed});
    }

    if(scenario?.monitorId === target.id && scenarioOpened !== null){
      // The incident opens on the third failed observation, not on the first one.
      const firstFailure = scenarioOpened - 2 * intervalMs;
      const failureEnd = scenarioRecovered === null ? now : Math.min(now,scenarioRecovered - 1);
      // Replace normal observations throughout the outage, so an open incident can
      // never have a later, contradictory successful check in its history.
      for(const at of byTime.keys()){
        if(at >= firstFailure && (scenarioRecovered === null || at < scenarioRecovered)) byTime.delete(at);
      }
      for(let at = firstFailure; at <= failureEnd; at += intervalMs){
        if(at >= windowStart) byTime.set(at,{at:iso(at),ms:null,success:false});
      }
      if(scenarioRecovered !== null && scenarioRecovered <= now && scenarioRecovered >= windowStart){
        byTime.set(scenarioRecovered,{at:iso(scenarioRecovered),ms:responseAt(scenarioRecovered),success:true});
      }
    }

    const points = [...byTime.entries()].sort((a,b)=>a[0]-b[0]).map(([,point])=>point);
    const binCount = period === '24h' ? 48 : 56;
    const binMs = windowMs / binCount;
    const uptimeBars:Monitor['uptime_bars'] = Array.from({length:binCount},(_,index)=>({at:iso(windowStart + index * binMs),status:'pending'}));
    for(const point of points){
      const index = Math.min(binCount - 1,Math.floor((Date.parse(point.at) - windowStart) / binMs));
      if(index < 0) continue;
      if(!point.success) uptimeBars[index].status = 'down';
      else if(uptimeBars[index].status !== 'down') uptimeBars[index].status = 'up';
    }
    const latest = points[points.length-1];
    let consecutiveFailures = 0;
    for(let i = points.length - 1; i >= 0 && !points[i].success; i--) consecutiveFailures++;
    return {id:target.id,name:target.name,url:target.url,
      status:consecutiveFailures >= 3 ? 'down' : consecutiveFailures ? 'degraded' : latest ? 'up' : 'pending',
      response_time_ms:latest?.success ? latest.ms : null,
      uptime_percentage:roundedPercentage(points.filter(point=>point.success).length,points.length),
      ssl_days_remaining:target.ssl,last_checked_at:latest?.at || null,
      consecutive_failures:consecutiveFailures,sparkline:points,
      uptime_bars:uptimeBars};
  });

  const incidents:Dashboard['incidents']=[{id:'sample-resolved-1',monitor_id:'portfolio',monitor_name:'Portfolio',status:'resolved',title:'Website unavailable',started_at:iso(sampleIncidentOpened),resolved_at:iso(sampleIncidentRecovered),duration_seconds:intervalSeconds}];
  if(scenario && scenarioOpened !== null && scenarioOpened <= now && (scenarioRecovered === null || scenarioRecovered >= windowStart)){
    const target=targets.find(target=>target.id===scenario.monitorId);
    if(target){
      const recovered = scenarioRecovered !== null && scenarioRecovered <= now;
      incidents.unshift({id:'sample-scenario',monitor_id:target.id,monitor_name:target.name,status:recovered?'resolved':'open',title:'Simulated availability failure',started_at:scenario.startedAt,resolved_at:recovered?scenario.resolvedAt:null,duration_seconds:Math.max(0,Math.round(((recovered?scenarioRecovered:now)!-scenarioOpened)/1000))});
    }
  }

  const readings=monitors.flatMap(monitor=>monitor.sparkline);
  const times=readings.filter(point=>point.success&&point.ms!==null).map(point=>point.ms!);
  return {mode:'demo',generated_at:iso(now),check_interval_seconds:intervalSeconds,
    summary:{total_monitors:monitors.length,healthy_monitors:monitors.filter(monitor=>monitor.status==='up').length,
      open_incidents:incidents.filter(incident=>incident.status==='open').length,
      uptime_percentage:roundedPercentage(readings.filter(point=>point.success).length,readings.length),
      average_response_ms:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):null},monitors,incidents};
}
