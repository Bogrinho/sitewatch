/// <reference types="node" />
import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { createDemo } from './demo.ts';
import type { Dashboard, Scenario } from './types';

const opened = Date.parse('2026-10-26T12:02:00.000Z');
const interval = 300000;
const openScenario:Scenario={monitorId:'storefront',startedAt:new Date(opened).toISOString(),resolvedAt:null};
const findMonitor=(dashboard:Dashboard,id='storefront')=>dashboard.monitors.find(monitor=>monitor.id===id)!;
function verifyMetrics(dashboard:Dashboard){
  const observations=dashboard.monitors.flatMap(monitor=>monitor.sparkline);
  const successes=observations.filter(point=>point.success);
  const responseTimes=successes.map(point=>point.ms!);
  equal(dashboard.summary.uptime_percentage,Number((successes.length/observations.length*100).toFixed(2)));
  equal(dashboard.summary.average_response_ms,Math.round(responseTimes.reduce((a,b)=>a+b,0)/responseTimes.length));
  equal(dashboard.summary.healthy_monitors,dashboard.monitors.filter(monitor=>monitor.status==='up').length);
  equal(dashboard.summary.open_incidents,dashboard.incidents.filter(incident=>incident.status==='open').length);
  for(const monitor of dashboard.monitors){
    equal(monitor.last_checked_at,monitor.sparkline.at(-1)!.at);
    equal(monitor.uptime_percentage,Number((monitor.sparkline.filter(point=>point.success).length/monitor.sparkline.length*100).toFixed(2)));
    ok(monitor.uptime_bars.length <= 56);
    monitor.uptime_bars.forEach((bar,index,bars)=>{
      const start=Date.parse(bar.at),end=Date.parse(bars[index+1]?.at||dashboard.generated_at);
      const checks=monitor.sparkline.filter(point=>Date.parse(point.at)>=start&&(index===bars.length-1?Date.parse(point.at)<=end:Date.parse(point.at)<end));
      equal(bar.status,checks.some(point=>!point.success)?'down':checks.length?'up':'pending');
    });
    ok(monitor.sparkline.every((point,index,points)=>!index||Date.parse(points[index-1].at)<Date.parse(point.at)));
  }
}

test('baseline is explicitly demo data with a coherent resolved incident',()=>{
  const data=createDemo('24h',null,opened);
  equal(data.mode,'demo'); equal(data.summary.healthy_monitors,3); equal(data.summary.open_incidents,0);
  const incident=data.incidents[0];
  const points=findMonitor(data,'portfolio').sparkline;
  const opening=Date.parse(incident.started_at);
  deepEqual(points.filter(point=>!point.success).map(point=>Date.parse(point.at)),[opening-2*interval,opening-interval,opening]);
  ok(points.find(point=>point.at===incident.resolved_at)?.success);
  equal(incident.duration_seconds,300);
  verifyMetrics(data);
});

test('outage opens at the third five-minute failure and leaves other monitors unchanged',()=>{
  for(const period of ['24h','7d'] as const){
    const baseline=createDemo(period,null,opened);
    const data=createDemo(period,openScenario,opened);
    const affected=findMonitor(data);
    equal(affected.status,'down'); equal(affected.consecutive_failures,3);
    deepEqual(affected.sparkline.slice(-3).map(point=>Date.parse(point.at)),[opened-2*interval,opened-interval,opened]);
    ok(affected.sparkline.slice(-3).every(point=>!point.success&&point.ms===null));
    equal(affected.last_checked_at,openScenario.startedAt);
    equal(data.incidents[0].started_at,affected.sparkline.at(-1)!.at);
    equal(data.incidents[0].duration_seconds,0);
    equal(data.summary.open_incidents,1);
    deepEqual(findMonitor(data,'portfolio'),findMonitor(baseline,'portfolio'));
    deepEqual(findMonitor(data,'company'),findMonitor(baseline,'company'));
    // Calling a scenario never mutates or retains state in a fresh baseline snapshot.
    deepEqual(createDemo(period,null,opened),baseline);
    verifyMetrics(data);
  }
});

test('ongoing outage produces only failed checks on the same five-minute cadence',()=>{
  const data=createDemo('24h',openScenario,opened+4*interval);
  const affected=findMonitor(data);
  equal(affected.status,'down'); equal(affected.consecutive_failures,7);
  const failures=affected.sparkline.filter(point=>Date.parse(point.at)>=opened-2*interval);
  equal(failures.length,7);ok(failures.every(point=>!point.success));
  equal(Date.parse(affected.last_checked_at!),opened+4*interval);
  equal(data.incidents[0].duration_seconds,1200);
  verifyMetrics(data);
});

test('recovery is a successful observation that closes the incident at the same timestamp',()=>{
  const resolvedAt=new Date(opened+interval).toISOString();
  const scenario={...openScenario,resolvedAt};
  const data=createDemo('24h',scenario,opened+interval);
  const affected=findMonitor(data);
  equal(affected.status,'up'); equal(affected.consecutive_failures,0);
  equal(affected.last_checked_at,resolvedAt);ok(affected.sparkline.at(-1)!.success);
  equal(affected.sparkline.filter(point=>!point.success).length,3);
  equal(data.incidents[0].status,'resolved'); equal(data.incidents[0].resolved_at,resolvedAt);
  equal(data.incidents[0].duration_seconds,300);equal(data.summary.open_incidents,0);
  equal(data.summary.healthy_monitors,3);
  verifyMetrics(data);
});

test('24-hour and seven-day windows share identical observations at matching timestamps',()=>{
  for(const scenario of [null,openScenario,{...openScenario,resolvedAt:new Date(opened+interval).toISOString()}]){
    const now=opened+interval;
    const day=createDemo('24h',scenario,now),week=createDemo('7d',scenario,now);
    for(const dayMonitor of day.monitors){
      const weekMonitor=findMonitor(week,dayMonitor.id);
      const map=new Map(weekMonitor.sparkline.map(point=>[point.at,point]));
      ok(weekMonitor.sparkline.length>dayMonitor.sparkline.length);
      for(const point of dayMonitor.sparkline)deepEqual(map.get(point.at),point);
    }
    deepEqual(day.incidents,week.incidents);
  }
});


test('availability bars are bounded aggregate bins and preserve a failed check after recovery',()=>{
  for(const period of ['24h','7d'] as const){
    const resolvedAt=new Date(opened+interval).toISOString();
    const data=createDemo(period,{...openScenario,resolvedAt},opened+interval);
    const monitor=findMonitor(data);
    equal(monitor.uptime_bars.length,period==='24h'?48:56);
    equal(monitor.status,'up');
    // A successful recovery does not erase the outage from its shared time bin.
    equal(monitor.uptime_bars.at(-1)!.status,'down');
    verifyMetrics(data);
  }
});
