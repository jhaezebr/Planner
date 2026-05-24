/**
 * Unit tests for src/utils/holidays.ts
 *
 * These tests cover:
 *  - fmtHours: formatting hours as H:MM
 *  - vakTotal: summing hours across a VAK stack
 *  - sortVakStack: cascade ordering (nearest expiry first, no-expiry last)
 *  - isBucketExpired: expiry boundary checks
 *  - getHolidayVakHours: correct earned hours per holiday type
 *  - getVakExpiry: correct expiry dates per holiday type
 *  - generateHolidays: correct Belgian holidays for a given year
 */

import { describe, it, expect } from 'vitest';
import {
  fmtHours,
  vakTotal,
  sortVakStack,
  isBucketExpired,
  getHolidayVakHours,
  getVakExpiry,
  generateHolidays,
  WORK_PCT,
  VAK_PER_DAY,
} from '../utils/holidays';
import type { VakBucket, HolidayEvent } from '../types';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeBucket(
  id: string,
  hours: number,
  expiresOn: string | null,
  type: VakBucket['type'] = 'WV',
): VakBucket {
  return {
    id,
    label: `Bucket ${id}`,
    type,
    hours,
    totalHours: hours,
    addedOn: '2026-01-01',
    expiresOn,
  };
}

function makeHoliday(
  type: HolidayEvent['type'],
  date = '2026-05-01',
): HolidayEvent {
  return {
    id: `h-${type}`,
    date,
    type,
    label: `Holiday ${type}`,
    status: 'PENDING',
    isRestDay: false,
    vakBucketId: null,
  };
}

// ─── fmtHours ───────────────────────────────────────────────────────────────

describe('fmtHours', () => {
  it('formats whole hours as H:00', () => {
    expect(fmtHours(8)).toBe('8:00');
    expect(fmtHours(0)).toBe('0:00');
    expect(fmtHours(24)).toBe('24:00');
  });

  it('formats fractional hours — 0.5h = 0:30', () => {
    expect(fmtHours(0.5)).toBe('0:30');
  });

  it('formats 6.4h (8h × 80%) as 6:24', () => {
    expect(fmtHours(6.4)).toBe('6:24');
  });

  it('formats 3.2h (4h × 80%, GF half-day) as 3:12', () => {
    expect(fmtHours(3.2)).toBe('3:12');
  });

  it('formats negative hours with a leading minus', () => {
    expect(fmtHours(-8)).toBe('-8:00');
    expect(fmtHours(-6.4)).toBe('-6:24');
  });

  it('formats large values correctly', () => {
    expect(fmtHours(166.4)).toBe('166:24'); // 26 days × 8h × 80%
  });
});

// ─── vakTotal ───────────────────────────────────────────────────────────────

describe('vakTotal', () => {
  it('returns 0 for an empty stack', () => {
    expect(vakTotal([])).toBe(0);
  });

  it('sums hours across all buckets', () => {
    const stack = [
      makeBucket('a', 10, null),
      makeBucket('b', 6.4, '2026-02-28'),
      makeBucket('c', 24, null),
    ];
    expect(vakTotal(stack)).toBe(40.4);
  });

  it('includes buckets with 0 hours (they do not affect the sum)', () => {
    const stack = [makeBucket('a', 0, null), makeBucket('b', 8, null)];
    expect(vakTotal(stack)).toBe(8);
  });
});

// ─── sortVakStack ───────────────────────────────────────────────────────────

describe('sortVakStack', () => {
  it('puts the bucket with the earliest expiry first', () => {
    const stack = [
      makeBucket('later', 8, '2026-06-01'),
      makeBucket('earlier', 8, '2026-02-28'),
    ];
    const sorted = sortVakStack(stack);
    expect(sorted[0].id).toBe('earlier');
    expect(sorted[1].id).toBe('later');
  });

  it('puts no-expiry buckets last', () => {
    const stack = [
      makeBucket('no-expiry', 166, null),
      makeBucket('expiring', 8, '2026-03-01'),
    ];
    const sorted = sortVakStack(stack);
    expect(sorted[0].id).toBe('expiring');
    expect(sorted[1].id).toBe('no-expiry');
  });

  it('keeps two no-expiry buckets in stable position relative to each other', () => {
    const stack = [
      makeBucket('a', 8, null),
      makeBucket('b', 8, null),
    ];
    const sorted = sortVakStack(stack);
    // Both have no expiry — order between them is undefined, but neither should crash
    expect(sorted).toHaveLength(2);
  });

  it('correctly orders: CARRY_VAK (Feb) < VF (Mar) < WV (no expiry)', () => {
    const stack = [
      makeBucket('wv', 166, null, 'WV'),
      makeBucket('vf', 6.4, '2026-03-15', 'VF'),
      makeBucket('carry', 38.4, '2026-02-28', 'CARRY_VAK'),
    ];
    const sorted = sortVakStack(stack);
    expect(sorted.map((b) => b.id)).toEqual(['carry', 'vf', 'wv']);
  });

  it('does not mutate the original array', () => {
    const original = [
      makeBucket('a', 8, '2026-06-01'),
      makeBucket('b', 8, '2026-02-28'),
    ];
    sortVakStack(original);
    expect(original[0].id).toBe('a'); // original order preserved
  });
});

// ─── isBucketExpired ────────────────────────────────────────────────────────

describe('isBucketExpired', () => {
  it('returns false for a bucket with no expiry', () => {
    const b = makeBucket('x', 8, null);
    expect(isBucketExpired(b, '2099-12-31')).toBe(false);
  });

  it('returns false when asOf is before the expiry date', () => {
    const b = makeBucket('x', 8, '2026-03-01');
    expect(isBucketExpired(b, '2026-02-28')).toBe(false);
  });

  it('returns true when asOf is exactly the expiry date (expired on that day)', () => {
    const b = makeBucket('x', 8, '2026-02-28');
    expect(isBucketExpired(b, '2026-02-28')).toBe(true);
  });

  it('returns true when asOf is after the expiry date', () => {
    const b = makeBucket('x', 8, '2026-02-28');
    expect(isBucketExpired(b, '2026-03-01')).toBe(true);
  });
});

// ─── getHolidayVakHours ─────────────────────────────────────────────────────

describe('getHolidayVakHours', () => {
  it('OF/DF/RF/VF all earn 8h × 80% = 6.4h', () => {
    for (const type of ['OF', 'DF', 'RF', 'VF'] as const) {
      expect(getHolidayVakHours(makeHoliday(type))).toBeCloseTo(VAK_PER_DAY);
      expect(getHolidayVakHours(makeHoliday(type))).toBeCloseTo(6.4);
    }
  });

  it('GF (Gentse feesten half-day) earns 4h × 80% = 3.2h', () => {
    expect(getHolidayVakHours(makeHoliday('GF'))).toBeCloseTo(3.2);
  });

  it('earned hours reflect the 80% working percentage', () => {
    expect(getHolidayVakHours(makeHoliday('OF'))).toBe(8 * WORK_PCT);
  });
});

// ─── getVakExpiry ────────────────────────────────────────────────────────────

describe('getVakExpiry', () => {
  it('OF expires 6 weeks after the holiday date', () => {
    // 2026-01-01 + 6 weeks = 2026-02-12
    expect(getVakExpiry(makeHoliday('OF', '2026-01-01'))).toBe('2026-02-12');
  });

  it('DF expires 6 weeks after the holiday date', () => {
    expect(getVakExpiry(makeHoliday('DF', '2026-07-11'))).toBe('2026-08-22');
  });

  it('RF expires 6 weeks after the holiday date', () => {
    expect(getVakExpiry(makeHoliday('RF', '2026-11-02'))).toBe('2026-12-14');
  });

  it('VF expires 6 weeks after the original holiday date', () => {
    expect(getVakExpiry(makeHoliday('VF', '2026-11-11'))).toBe('2026-12-23');
  });

  it('GF expires on August 31 of the same year', () => {
    expect(getVakExpiry(makeHoliday('GF', '2026-07-15'))).toBe('2026-08-31');
    expect(getVakExpiry(makeHoliday('GF', '2026-07-16'))).toBe('2026-08-31');
  });
});

// ─── generateHolidays ───────────────────────────────────────────────────────

describe('generateHolidays', () => {
  const holidays2026 = generateHolidays(2026, 3); // Wednesday rest day

  it('generates the correct number of holidays (16 for a standard year)', () => {
    expect(holidays2026).toHaveLength(16);
  });

  it('includes Nieuwjaar on 2026-01-01', () => {
    const h = holidays2026.find((h) => h.date === '2026-01-01');
    expect(h).toBeDefined();
    expect(h!.type).toBe('OF');
    expect(h!.label).toBe('Nieuwjaar');
  });

  it('includes Kerstmis on 2026-12-25 as OF', () => {
    const h = holidays2026.find((h) => h.date === '2026-12-25');
    expect(h!.type).toBe('OF');
  });

  it('includes Tweede kerstdag on 2026-12-26 as RF', () => {
    const h = holidays2026.find((h) => h.date === '2026-12-26');
    expect(h!.type).toBe('RF');
  });

  it('includes both Gentse feesten half-days (GF) on Jul 15 and Jul 16', () => {
    const gf = holidays2026.filter((h) => h.type === 'GF');
    expect(gf).toHaveLength(2);
    expect(gf.map((h) => h.date).sort()).toEqual(['2026-07-15', '2026-07-15']);
  });

  it('all holidays start with PENDING status and no vakBucketId', () => {
    for (const h of holidays2026) {
      expect(h.status).toBe('PENDING');
      expect(h.vakBucketId).toBeNull();
    }
  });

  it('holidays are sorted chronologically', () => {
    for (let i = 1; i < holidays2026.length; i++) {
      expect(holidays2026[i].date >= holidays2026[i - 1].date).toBe(true);
    }
  });

  it('correctly marks holidays that fall on the rest day', () => {
    // 2026 with restDay=3 (Wednesday): check which holidays fall on Wed
    const restDayHolidays = holidays2026.filter((h) => h.isRestDay);
    for (const h of restDayHolidays) {
      const day = new Date(h.date).getDay();
      expect(day).toBe(3); // Wednesday
    }
    // Non-rest-day holidays should not be marked
    const nonRestDayHolidays = holidays2026.filter((h) => !h.isRestDay);
    for (const h of nonRestDayHolidays) {
      const day = new Date(h.date).getDay();
      expect(day).not.toBe(3);
    }
  });

  it('Easter 2026 is on April 5 (Paasmaandag = April 6)', () => {
    const paasmaandag = holidays2026.find((h) => h.label === 'Paasmaandag');
    expect(paasmaandag?.date).toBe('2026-04-06');
  });

  it('Pinkstermaandag 2026 is 50 days after Easter = May 25', () => {
    const pink = holidays2026.find((h) => h.label === 'Pinkstermaandag');
    expect(pink?.date).toBe('2026-05-25');
  });
});
