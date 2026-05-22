/** Warehouse calendar day for delivery-note daily stats. */
export const DELIVERY_NOTE_STATS_TIMEZONE = 'America/Vancouver';

export type LocalDayBoundsUtc = {
  localDate: string;
  startUtc: Date;
  endUtc: Date;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(timeZone: string, utc: Date): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(utc)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function compareZoned(a: ZonedParts, b: ZonedParts): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  if (a.day !== b.day) return a.day - b.day;
  if (a.hour !== b.hour) return a.hour - b.hour;
  if (a.minute !== b.minute) return a.minute - b.minute;
  return a.second - b.second;
}

/** Map a local date/time in `timeZone` to the corresponding UTC instant. */
export function localDateTimeToUtc(
  timeZone: string,
  ymd: string,
  hour: number,
  minute: number,
  second: number,
): Date {
  const [Y, M, D] = ymd.split('-').map((x) => Number(x));
  const target: ZonedParts = {
    year: Y,
    month: M,
    day: D,
    hour,
    minute,
    second,
  };

  let lo = Date.UTC(Y, M - 1, D - 2, 0, 0, 0);
  let hi = Date.UTC(Y, M - 1, D + 2, 23, 59, 59);

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const z = zonedParts(timeZone, new Date(mid));
    if (compareZoned(z, target) < 0) lo = mid + 1;
    else hi = mid;
  }

  return new Date(lo);
}

/** Inclusive start, exclusive end of the local calendar day containing `ref`. */
export function getLocalDayBoundsUtc(
  timeZone: string,
  ref: Date = new Date(),
): LocalDayBoundsUtc {
  const localDate = ref.toLocaleDateString('en-CA', { timeZone });
  const startUtc = localDateTimeToUtc(timeZone, localDate, 0, 0, 0);

  let bump = startUtc.getTime() + 20 * 60 * 60 * 1000;
  let nextLocal = new Date(bump).toLocaleDateString('en-CA', { timeZone });
  while (nextLocal === localDate) {
    bump += 60 * 60 * 1000;
    nextLocal = new Date(bump).toLocaleDateString('en-CA', { timeZone });
  }
  const endUtc = localDateTimeToUtc(timeZone, nextLocal, 0, 0, 0);

  return { localDate, startUtc, endUtc };
}

export function getVancouverDayBoundsUtc(ref: Date = new Date()): LocalDayBoundsUtc {
  return getLocalDayBoundsUtc(DELIVERY_NOTE_STATS_TIMEZONE, ref);
}
