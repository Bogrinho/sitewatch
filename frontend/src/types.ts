export type Period = '24h' | '7d';
export type Mode = 'demo' | 'live';
export type MonitorStatus = 'up' | 'degraded' | 'down' | 'pending' | 'unknown';
export interface CheckPoint { at: string; ms: number | null; success: boolean }
export interface UptimeBar { at: string; status: 'up' | 'down' | 'pending' }
export interface Monitor {
  id: string; name: string; url: string; status: MonitorStatus;
  response_time_ms: number | null; uptime_percentage: number | null;
  ssl_days_remaining: number | null; last_checked_at: string | null;
  consecutive_failures: number; sparkline: CheckPoint[]; uptime_bars: UptimeBar[];
  slow_active?: boolean; slow_threshold_ms?: number; stale?: boolean; observation_error?: string | null;
}
export interface Incident {
  id: string; monitor_id: string; monitor_name: string; status: 'open' | 'resolved';
  title: string; started_at: string; resolved_at: string | null; duration_seconds: number;
}
export interface Dashboard {
  mode: Mode; generated_at: string; check_interval_seconds: number;
  summary: {total_monitors: number; healthy_monitors: number; open_incidents: number;
    uptime_percentage: number | null; average_response_ms: number | null};
  monitors: Monitor[]; incidents: Incident[];
}
export interface Scenario { monitorId: string; startedAt: string; resolvedAt: string | null }
