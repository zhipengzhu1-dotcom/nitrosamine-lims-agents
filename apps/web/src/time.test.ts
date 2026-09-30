import { describe, expect, it } from 'vitest';
import { labTime } from './time';

describe('labTime (rule 9)', () => {
  it('derives the zone abbreviation from the IANA zone at each instant', () => {
    const summer = labTime({ utc: '2026-07-14T14:40:12Z', zone: 'America/New_York' });
    const winter = labTime({ utc: '2026-01-14T14:40:12Z', zone: 'America/New_York' });
    expect([summer.time, summer.zone]).toEqual(['10:40', 'EDT']);
    expect([winter.time, winter.zone]).toEqual(['09:40', 'EST']);
    expect(summer.utcTime).toBe('14:40');
  });

  it('crosses the date line with the zone, not the browser', () => {
    const t = labTime({ utc: '2026-03-01T20:30:00Z', zone: 'Asia/Shanghai' }, { seconds: true });
    expect([t.date, t.time, t.utcDate]).toEqual(['2026-03-02', '04:30:00', '2026-03-01']);
  });

  it('treats an unparseable instant as a bug', () => {
    expect(() => labTime({ utc: 'yesterday', zone: 'UTC' })).toThrow();
  });
});
