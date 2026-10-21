/**
 * Counts the relay's own Edge Function calls (DOR-133). Each is an invocation
 * of Supabase's Free plan, 500,000 a month for the one project dev and prod
 * share. Every EDGE_CALLS_EVERY_MS the relay logs `edge_calls`: the calls of
 * the last hour as a rate per day, which the VPS health check adds up across
 * the relays and alerts on above HEALTH_EDGE_CALLS_MAX_PER_DAY (about 12,000,
 * some 360,000 a month), and the UTC day's count so far. When a day ends, its
 * total as `edge_calls_day`. An hour, not five minutes: judges writing for a
 * few minutes are no trend, a loop calling without pause is one within
 * minutes. The sandboxes' own calls to notch-tools aren't counted here.
 */

export const EDGE_CALLS_EVERY_MS = 5 * 60_000;
const WINDOW_MS = 60 * 60_000;
/** A rate from less than this is noise: none is reported, so none is judged. */
const MIN_WINDOW_MS = 15 * 60_000;

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type EdgeCallsReport = {
  /** How many minutes the rate covers: the last hour, or since the relay started. */
  minutes: number;
  calls: number;
  /** calls over those minutes, per day; null under MIN_WINDOW_MS. */
  perDay: number | null;
  day: string;
  today: number;
  /** Since the last report, by function and action (e.g. "assistant-outbox:claim"). */
  byCall: Record<string, number>;
};

export class EdgeCallMeter {
  private windows: Array<{ from: number; calls: number }> = [];
  private from: number;
  private calls = 0;
  private byCall = new Map<string, number>();
  private day: string;
  private today = 0;
  private ended: { day: string; calls: number }[] = [];

  constructor(private readonly now: () => number = Date.now) {
    this.from = now();
    this.day = utcDay(this.from);
  }

  record(fn: string, action?: string): void {
    this.rollDay();
    this.calls++;
    this.today++;
    const key = action ? `${fn}:${action}` : fn;
    this.byCall.set(key, (this.byCall.get(key) ?? 0) + 1);
  }

  /** The events to log now, and a new interval begun. */
  report(): Array<["edge_calls_day", { day: string; calls: number }] | ["edge_calls", EdgeCallsReport]> {
    this.rollDay();
    const now = this.now();
    this.windows.push({ from: this.from, calls: this.calls });
    this.windows = this.windows.filter((w) => now - w.from <= WINDOW_MS);
    const span = this.windows.length ? now - this.windows[0].from : 0;
    const calls = this.windows.reduce((sum, w) => sum + w.calls, 0);
    const report: EdgeCallsReport = {
      minutes: Math.round(span / 60_000),
      calls,
      perDay: span >= MIN_WINDOW_MS ? Math.round((calls / span) * 86_400_000) : null,
      day: this.day,
      today: this.today,
      byCall: Object.fromEntries([...this.byCall].sort(([a], [b]) => a.localeCompare(b))),
    };
    const out: ReturnType<EdgeCallMeter["report"]> = this.ended.map((d) => ["edge_calls_day", d] as const);
    out.push(["edge_calls", report]);
    this.ended = [];
    this.from = now;
    this.calls = 0;
    this.byCall = new Map();
    return out;
  }

  private rollDay(): void {
    const day = utcDay(this.now());
    if (day === this.day) return;
    this.ended.push({ day: this.day, calls: this.today });
    this.day = day;
    this.today = 0;
  }
}
