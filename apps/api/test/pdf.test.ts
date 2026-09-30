// Rule 9 on the issued PDF: a signature's Lab-local time carries the zone's abbreviation, derived
// from the IANA zone at that instant, so a July signature in New York prints EDT and a January one EST.
import { describe, expect, it } from 'vitest';
import { labLocalTime } from '../src/chain/pdf.ts';

describe('the PDF prints Lab-local time with the zone abbreviation', () => {
  it('EDT in summer and EST in winter, never a GMT offset', () => {
    expect(labLocalTime(new Date('2026-07-14T13:09:10Z'), 'America/New_York')).toBe('2026-07-14 09:09:10 EDT');
    expect(labLocalTime(new Date('2026-01-14T13:09:10Z'), 'America/New_York')).toBe('2026-01-14 08:09:10 EST');
    expect(labLocalTime(new Date('2026-07-14T13:09:10Z'), 'America/New_York')).not.toMatch(/GMT/);
  });
});
