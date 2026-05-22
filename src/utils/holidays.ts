import { addWeeks, format, getDay, parseISO, isAfter } from 'date-fns';
import type { HolidayEvent, HolidayType, VakBucket } from '../types';

export const WORK_PCT = 0.8;
export const HOURS_PER_DAY = 8;
export const VAK_PER_DAY = HOURS_PER_DAY * WORK_PCT; // 6.4h
export const QUARTERLY_RV = 24 * WORK_PCT; // hours added per quarter, prorated to work% (= 19.2h at 80%)
export const MAX_CARRY_VAK_HOURS = Math.round(6 * HOURS_PER_DAY * WORK_PCT * 10) / 10;
export const MAX_CARRY_RV_HOURS = 24;
export const VF_EXPIRY_WEEKS = 6;

export const HOLIDAY_COLORS: Record<HolidayType, string> = {
  OF: 'bg-red-100 text-red-800 border-red-300',
  DF: 'bg-orange-100 text-orange-800 border-orange-300',
  RF: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  VF: 'bg-purple-100 text-purple-800 border-purple-300',
  GF: 'bg-green-100 text-green-800 border-green-300',
};

export const HOLIDAY_LABELS: Record<HolidayType, string> = {
  OF: 'Officiële feestdag',
  DF: 'Decretale feestdag',
  RF: 'Reglementaire feestdag',
  VF: 'Vervangingsfeestdag',
  GF: 'Gentse feesten',
};

export const DAY_NAMES = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
export const DAY_NAMES_SHORT = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];

/**
 * Dates for variable (Easter-based) Belgian public holidays.
 * These can be fetched from the OpenHolidays API or calculated locally as fallback.
 */
export interface VariableHolidayDates {
  easterMonday: string; // YYYY-MM-DD
  ascension: string;    // YYYY-MM-DD
  whitMonday: string;   // YYYY-MM-DD
}

/**
 * Fetch variable holiday dates from openholidaysapi.org.
 * Falls back to the local Easter algorithm on any network / parse error.
 */
export async function fetchVariableHolidayDates(year: number): Promise<VariableHolidayDates> {
  const fallback = (): VariableHolidayDates => {
    const easter = getEaster(year);
    return {
      easterMonday: format(addDays(easter, 1), 'yyyy-MM-dd'),
      ascension:    format(addDays(easter, 39), 'yyyy-MM-dd'),
      whitMonday:   format(addDays(easter, 50), 'yyyy-MM-dd'),
    };
  };

  try {
    const url =
      `https://openholidaysapi.org/PublicHolidays` +
      `?countryIsoCode=BE&languageIsoCode=NL` +
      `&validFrom=${year}-01-01&validTo=${year}-12-31`;
    const res = await fetch(url);
    if (!res.ok) return fallback();

    const holidays: Array<{ startDate: string; name: Array<{ language: string; text: string }> }> =
      await res.json();

    const find = (keyword: string): string | undefined =>
      holidays.find((h) =>
        h.name.some((n) => n.language === 'NL' && n.text.toLowerCase().includes(keyword.toLowerCase())),
      )?.startDate;

    const fb = fallback();
    return {
      easterMonday: find('Paasmaandag') ?? fb.easterMonday,
      ascension:    find('Hemelvaart')  ?? fb.ascension,
      whitMonday:   find('Pinkstermaandag') ?? fb.whitMonday,
    };
  } catch {
    return fallback();
  }
}

/** Generate the standard Belgian public holidays + GF for a given year */
export function generateHolidays(
  year: number,
  restDay: number,
  variableDates?: VariableHolidayDates,
): HolidayEvent[] {
  const make = (
    dateStr: string,
    type: HolidayType,
    label: string,
  ): HolidayEvent => {
    const d = parseISO(dateStr);
    return {
      id: `holiday-${dateStr}-${type}`,
      date: dateStr,
      type,
      label,
      status: 'PENDING',
      isRestDay: getDay(d) === restDay,
      vakBucketId: null,
    };
  };

  // Easter-based dates: use pre-fetched dates when available, fall back to local algorithm
  const easter = getEaster(year);
  const easterMonday = variableDates?.easterMonday ?? format(addDays(easter, 1), 'yyyy-MM-dd');
  const ascension    = variableDates?.ascension    ?? format(addDays(easter, 39), 'yyyy-MM-dd');
  const whitMonday   = variableDates?.whitMonday   ?? format(addDays(easter, 50), 'yyyy-MM-dd');

  return [
    make(`${year}-01-01`, 'OF', 'Nieuwjaar'),
    make(easterMonday,    'OF', 'Paasmaandag'),
    make(`${year}-05-01`, 'OF', 'Dag van de Arbeid'),
    make(ascension,       'OF', 'O.H. Hemelvaart'),
    make(whitMonday,      'OF', 'Pinkstermaandag'),
    make(`${year}-07-11`, 'DF', 'Feest van de Vlaamse Gemeenschap'),
    make(`${year}-07-21`, 'OF', 'Nationale feestdag'),   // Belgian National Day (not Jul 14)
    make(`${year}-07-15`, 'GF', 'Gentse feesten (halve dag 1)'),
    make(`${year}-07-15`, 'GF', 'Gentse feesten (halve dag 2)'),
    make(`${year}-08-15`, 'OF', 'O.L.V. Hemelvaart'),
    make(`${year}-11-01`, 'OF', 'Allerheiligen'),
    make(`${year}-11-02`, 'RF', 'Allerzielen'),
    make(`${year}-11-11`, 'OF', 'Wapenstilstand'),
    make(`${year}-11-15`, 'RF', 'Feest van de Dynastie'),
    make(`${year}-12-25`, 'OF', 'Kerstmis'),
    make(`${year}-12-26`, 'RF', 'Tweede kerstdag'),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Tonc's algorithm for Easter Sunday */
function getEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Compute expiry date for a holiday being marked as taken */
export function getVakExpiry(holiday: HolidayEvent): string | null {
  const d = parseISO(holiday.date);
  switch (holiday.type) {
    case 'VF':
      return format(addWeeks(d, VF_EXPIRY_WEEKS), 'yyyy-MM-dd');
    case 'GF':
      // GF expires Aug 31 of same year
      return `${d.getFullYear()}-08-31`;
    case 'OF':
    case 'DF':
    case 'RF':
      // These expire 6 weeks after the holiday (same rule if missed / rest-day collision)
      return format(addWeeks(d, VF_EXPIRY_WEEKS), 'yyyy-MM-dd');
    default:
      return null;
  }
}

/** Hours added to VAK when a holiday is marked as taken */
export function getHolidayVakHours(holiday: HolidayEvent, workPct: number = WORK_PCT): number {
  if (holiday.type === 'GF') return (HOURS_PER_DAY / 2) * workPct;
  return HOURS_PER_DAY * workPct;
}

/** Sort VAK buckets: null expiry (no-expiry) goes last, nearest expiry goes first */
export function sortVakStack(buckets: VakBucket[]): VakBucket[] {
  return [...buckets].sort((a, b) => {
    if (a.expiresOn === null && b.expiresOn === null) return 0;
    if (a.expiresOn === null) return 1;
    if (b.expiresOn === null) return -1;
    return a.expiresOn.localeCompare(b.expiresOn);
  });
}

/** Check if a bucket is expired as of a given ISO date string */
export function isBucketExpired(bucket: VakBucket, asOf: string): boolean {
  if (!bucket.expiresOn) return false;
  return !isAfter(parseISO(bucket.expiresOn), parseISO(asOf));
}

/** Format hours as h:mm */
export function fmtHours(hours: number): string {
  const sign = hours < 0 ? '-' : '';
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `${sign}${h}:${m.toString().padStart(2, '0')}`;
}

/** Total remaining hours in the VAK stack */
export function vakTotal(buckets: VakBucket[]): number {
  return buckets.reduce((s, b) => s + b.hours, 0);
}

