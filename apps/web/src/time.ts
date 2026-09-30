import type { ServerInstant } from './model';

export type LabTime = {
  /** Lab-local wall time, 24-hour, e.g. "10:40" */
  readonly time: string;
  /** Lab-local date, e.g. "2026-09-30" */
  readonly date: string;
  /** The zone's abbreviation at this instant, e.g. "EDT" in July and "EST" in January. */
  readonly zone: string;
  readonly utcTime: string;
  readonly utcDate: string;
};

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, seconds: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${seconds}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...(seconds ? { second: '2-digit' } : {}),
      hourCycle: 'h23',
      timeZoneName: 'short',
    });
    cache.set(key, f);
  }
  return f;
}

function parts(date: Date, timeZone: string, seconds: boolean) {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter(timeZone, seconds).formatToParts(date)) p[part.type] = part.value;
  const time = [p.hour, p.minute, ...(seconds ? [p.second] : [])].join(':');
  return { time, date: `${p.year}-${p.month}-${p.day}`, zone: p.timeZoneName ?? timeZone };
}

/** Derives lab-local time and the zone abbreviation from the IANA zone at the instant itself (rule 9). */
export function labTime(instant: ServerInstant, options: { seconds?: boolean } = {}): LabTime {
  const seconds = options.seconds ?? false;
  const at = new Date(instant.utc);
  if (Number.isNaN(at.getTime())) throw new Error(`Not an ISO instant: ${instant.utc}`);
  const local = parts(at, instant.zone, seconds);
  const utc = parts(at, 'UTC', seconds);
  return { time: local.time, date: local.date, zone: local.zone, utcTime: utc.time, utcDate: utc.date };
}

/** "10:40 EDT" */
export function shortLabTime(instant: ServerInstant): string {
  const t = labTime(instant);
  return `${t.time} ${t.zone}`;
}
