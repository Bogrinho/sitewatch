// Pure transitions are shared by the scheduled checker and regression tests.
export function transition(monitor, check, sslDays = 14) {
  const m = {...monitor};
  const notices = [];
  let incident = null;
  const add = (suffix, body) => notices.push({
    subject: `SiteWatch: ${m.name} ${suffix}`,
    body: `${body}\n${m.url}`
  });
  if (check.success) {
    m.consecutive_failures = 0;
    m.status = 'up';
    if (monitor.status === 'down') {
      incident = 'resolve';
      add('recovered', `${m.name} is responding successfully again.`);
    }
    if (check.response_time_ms !== null && check.response_time_ms > m.slow_ms) {
      m.slow_streak++;
      if (m.slow_streak >= 3 && !m.slow_active) {
        m.slow_active = 1;
        add('is slow', `Three consecutive responses exceeded ${m.slow_ms} ms.`);
      }
    } else if (check.response_time_ms !== null) {
      if (m.slow_active) add('response recovered', `The latest response is within the ${m.slow_ms} ms limit.`);
      m.slow_streak = 0;
      m.slow_active = 0;
    }
  } else {
    m.slow_streak = 0;
    m.consecutive_failures++;
    m.status = monitor.status==='down'||m.consecutive_failures >= 3 ? 'down' : 'degraded';
    if (m.consecutive_failures === 3 && monitor.status!=='down') {
      incident = 'open';
      add('is down', `${m.name} failed three consecutive checks.`);
    }
  }
  if (check.ssl_days_remaining !== null) {
    if (check.ssl_days_remaining <= sslDays && !m.ssl_alerted) {
      m.ssl_alerted = 1;
      add('SSL certificate', `The certificate has ${check.ssl_days_remaining} days remaining.`);
    } else if (check.ssl_days_remaining > sslDays) m.ssl_alerted = 0;
  }
  return {monitor:m, notices, incident};
}
