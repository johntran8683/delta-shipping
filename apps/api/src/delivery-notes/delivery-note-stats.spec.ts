import {
  DELIVERY_NOTE_STATS_TIMEZONE,
  getLocalDayBoundsUtc,
  getVancouverDayBoundsUtc,
  localDateTimeToUtc,
} from './delivery-note-stats';

describe('delivery-note-stats', () => {
  it('maps Vancouver midnight to UTC', () => {
    const utc = localDateTimeToUtc(
      DELIVERY_NOTE_STATS_TIMEZONE,
      '2026-01-15',
      0,
      0,
      0,
    );
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: DELIVERY_NOTE_STATS_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).format(utc);
    expect(Number(parts)).toBe(0);
  });

  it('returns a full local day range', () => {
    const ref = new Date('2026-06-15T18:00:00.000Z');
    const { localDate, startUtc, endUtc } = getVancouverDayBoundsUtc(ref);
    expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(endUtc.getTime()).toBeGreaterThan(startUtc.getTime());
    const spanHours = (endUtc.getTime() - startUtc.getTime()) / 3_600_000;
    expect(spanHours).toBe(24);
    expect(ref.getTime()).toBeGreaterThanOrEqual(startUtc.getTime());
    expect(ref.getTime()).toBeLessThan(endUtc.getTime());
  });

  it('uses America/Vancouver for warehouse stats', () => {
    const bounds = getLocalDayBoundsUtc(DELIVERY_NOTE_STATS_TIMEZONE);
    expect(bounds.localDate).toBe(
      new Date().toLocaleDateString('en-CA', {
        timeZone: DELIVERY_NOTE_STATS_TIMEZONE,
      }),
    );
  });
});
