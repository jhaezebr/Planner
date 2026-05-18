/**
 * Unit tests for the Zustand store (usePlanStore)
 *
 * Because Zustand stores are module-level singletons, we reset the store
 * before each test using the resetAll action.
 *
 * Tests are grouped by action and cover:
 *  - initYear: VAK stack seeding, RV initialisation, carry-overs, holidays
 *  - markHolidayTaken: VAK earn + leave cost, rest-day flag, GF half-day
 *  - markHolidayExpired: status transition only
 *  - addLeave (VAK / RV / AUTO / overflow)
 *  - removeLeave: exact restoration of VAK buckets and RV balance
 *  - expireBuckets: pruning and logging of expired buckets
 *  - removeHoliday: removes holiday and its linked VAK bucket
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePlanStore } from '../store/usePlanStore';
import { VAK_PER_DAY, QUARTERLY_RV, vakTotal } from '../utils/holidays';

// Helper: get the current store state
const s = () => usePlanStore.getState();

// Standard test year configuration
const YEAR = 2026;
const REST_DAY = 3; // Wednesday

function initClean(carryVakHours = 0, carryRvHours = 0) {
  s().initYear(YEAR, REST_DAY, carryVakHours, carryRvHours);
}

beforeEach(() => {
  s().resetAll();
});

// ─── initYear ───────────────────────────────────────────────────────────────

describe('initYear', () => {
  it('marks the store as initialized', () => {
    initClean();
    expect(s().settings.initialized).toBe(true);
    expect(s().settings.year).toBe(YEAR);
    expect(s().settings.restDay).toBe(REST_DAY);
  });

  it('creates a base WV bucket worth 26 × 8h × 80% = 166.4h', () => {
    initClean();
    const wv = s().vakStack.find((b) => b.type === 'WV');
    expect(wv).toBeDefined();
    expect(wv!.hours).toBeCloseTo(26 * 8 * 0.8); // 166.4
    expect(wv!.expiresOn).toBeNull();
  });

  it('adds carry-over VAK (capped at 6 days = 38.4h) expiring Feb 28', () => {
    initClean(4 * VAK_PER_DAY, 0); // 25.6h carry-over
    const carry = s().vakStack.find((b) => b.type === 'CARRY_VAK');
    expect(carry).toBeDefined();
    expect(carry!.hours).toBeCloseTo(4 * VAK_PER_DAY);
    expect(carry!.expiresOn).toBe(`${YEAR}-02-28`);
  });

  it('caps carry-over VAK at 38.4h even if more is provided', () => {
    initClean(999, 0); // 999h requested, only 38.4h allowed
    const carry = s().vakStack.find((b) => b.type === 'CARRY_VAK');
    expect(carry!.hours).toBeCloseTo(6 * VAK_PER_DAY); // 38.4h
  });

  it('does NOT add carry-over VAK to the stack when hours = 0', () => {
    initClean(0, 0);
    const carry = s().vakStack.find((b) => b.type === 'CARRY_VAK');
    expect(carry).toBeUndefined();
  });

  it('adds carry-over RV to the RV BALANCE (not the VAK stack)', () => {
    initClean(0, 20);
    // Should NOT be in VAK stack
    expect(s().vakStack.find((b) => b.type === 'CARRY_RV')).toBeUndefined();
    // Must be in RV balance: 20h carry + 4 × 24h quarterly = 116h
    expect(s().rvBalance).toBeCloseTo(20 + 4 * QUARTERLY_RV);
  });

  it('caps carry-over RV at 24h', () => {
    initClean(0, 50); // 50h requested, only 24h allowed
    // 24h carry + 96h quarterly = 120h
    expect(s().rvBalance).toBeCloseTo(24 + 4 * QUARTERLY_RV);
  });

  it('adds 4 quarterly RV top-ups of 24h each (96h total)', () => {
    initClean();
    const quarterlyTxs = s().rvTransactions.filter((tx) =>
      tx.label === 'Kwartaaltoewijzing RV',
    );
    expect(quarterlyTxs).toHaveLength(4);
    expect(s().rvBalance).toBeCloseTo(4 * QUARTERLY_RV); // 96h
  });

  it('quarterly RV transactions are on Jan 1, Apr 1, Jul 1, Oct 1', () => {
    initClean();
    const qtxs = s().rvTransactions.filter((tx) => tx.label === 'Kwartaaltoewijzing RV');
    const dates = qtxs.map((tx) => tx.date).sort();
    expect(dates).toEqual([
      `${YEAR}-01-01`,
      `${YEAR}-04-01`,
      `${YEAR}-07-01`,
      `${YEAR}-10-01`,
    ]);
  });

  it('pre-populates 16 holiday events all with TAKEN status and their VAK buckets', () => {
    initClean();
    expect(s().holidayEvents).toHaveLength(16);
    expect(s().holidayEvents.every((h) => h.status === 'TAKEN')).toBe(true);
    expect(s().holidayEvents.every((h) => h.vakBucketId !== null)).toBe(true);
  });

  it('vakStack after initYear includes WV + 16 holiday buckets (no carry)', () => {
    initClean();
    // 14 full-day holidays (6.4h each) + 2 GF half-days (3.2h each) + WV
    const wv = s().vakStack.find((b) => b.type === 'WV')!;
    expect(wv).toBeDefined();
    expect(wv.hours).toBeCloseTo(26 * 8 * 0.8); // 166.4h
    // Total holiday bucket hours: 14 × 6.4 + 2 × 3.2 = 96h
    const holidayBucketHours = s().vakStack
      .filter((b) => b.type !== 'WV' && b.type !== 'CARRY_VAK')
      .reduce((sum, b) => sum + b.hours, 0);
    expect(holidayBucketHours).toBeCloseTo(96);
  });

  it('clears existing leave entries on re-initialisation', () => {
    initClean();
    s().addLeave(`${YEAR}-06-01`, 8, 'RV');
    expect(s().leaveEntries).toHaveLength(1);
    initClean(); // re-init
    expect(s().leaveEntries).toHaveLength(0);
  });

  it('CARRY_VAK bucket is sorted before WV (nearest expiry first)', () => {
    initClean(3 * VAK_PER_DAY, 0);
    const stack = s().vakStack;
    const carryIdx = stack.findIndex((b) => b.type === 'CARRY_VAK');
    const wvIdx = stack.findIndex((b) => b.type === 'WV');
    expect(carryIdx).toBeGreaterThanOrEqual(0);
    expect(wvIdx).toBe(stack.length - 1); // WV (no expiry) is always last
    expect(carryIdx).toBeLessThan(wvIdx); // CARRY_VAK sorts before WV
  });

  it('each holiday event maps to exactly one bucket in vakStack (no duplicate buckets)', () => {
    initClean();
    const takenHolidays = s().holidayEvents.filter((h) => h.vakBucketId !== null);
    const bucketIds = takenHolidays.map((h) => h.vakBucketId!);
    const uniqueBucketIds = new Set(bucketIds);
    // Every vakBucketId must be unique — no two holidays share a bucket
    expect(uniqueBucketIds.size).toBe(takenHolidays.length);
    // Every vakBucketId must exist in the vakStack
    for (const id of bucketIds) {
      expect(s().vakStack.some((b) => b.id === id)).toBe(true);
    }
  });

  it('each holiday has exactly one expiry date (no holiday-type bucket appears twice)', () => {
    initClean();
    const holidayBuckets = s().vakStack.filter(
      (b) => !['WV', 'CARRY_VAK', 'CARRY_RV'].includes(b.type),
    );
    // Each holiday event should produce at most one bucket
    const takenHolidays = s().holidayEvents.filter((h) => h.vakBucketId !== null);
    expect(holidayBuckets.length).toBe(takenHolidays.length);
    // No two buckets should have the same (label, expiresOn) pair
    const labelExpiry = holidayBuckets.map((b) => `${b.label}|${b.expiresOn}`);
    expect(new Set(labelExpiry).size).toBe(holidayBuckets.length);
  });

  it('re-initialising the year does NOT accumulate duplicate holiday buckets', () => {
    initClean();
    const countAfterFirst = s().vakStack.filter(
      (b) => !['WV', 'CARRY_VAK', 'CARRY_RV'].includes(b.type),
    ).length;
    initClean(); // re-init same year
    const countAfterSecond = s().vakStack.filter(
      (b) => !['WV', 'CARRY_VAK', 'CARRY_RV'].includes(b.type),
    ).length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});

// ─── markHolidayTaken ───────────────────────────────────────────────────────

// Helper: inject a PENDING holiday into the store for testing markHolidayTaken
function injectPending(date: string, type: 'VF' | 'RF' | 'GF' = 'VF') {
  usePlanStore.setState((st) => ({
    holidayEvents: [
      ...st.holidayEvents,
      { id: `test-${date}`, date, type, label: `Test ${type}`, status: 'PENDING' as const, isRestDay: false, vakBucketId: null },
    ],
  }));
  return `test-${date}`;
}

describe('markHolidayTaken (earn-only — no leave deduction)', () => {
  it('is a no-op for an already TAKEN holiday (all initYear holidays are TAKEN)', () => {
    initClean();
    const h = s().holidayEvents[0]; // TAKEN by initYear
    const vakBefore = vakTotal(s().vakStack);
    s().markHolidayTaken(h.id); // no-op
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore);
  });

  it('adds +6.4h VAK bucket and marks PENDING holiday as TAKEN', () => {
    initClean();
    const id = injectPending(`${YEAR}-08-20`);
    const vakBefore = vakTotal(s().vakStack);
    s().markHolidayTaken(id);
    expect(s().holidayEvents.find((h) => h.id === id)!.status).toBe('TAKEN');
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore + VAK_PER_DAY); // +6.4h only
  });

  it('does NOT create a leave entry (leave booking is separate)', () => {
    initClean();
    const id = injectPending(`${YEAR}-09-01`);
    const leavesBefore = s().leaveEntries.length;
    s().markHolidayTaken(id);
    expect(s().leaveEntries.length).toBe(leavesBefore); // no leave entry
  });

  it('GF holiday earns 3.2h (half-day × 80%) — no leave cost', () => {
    initClean();
    const id = injectPending(`${YEAR}-07-17`, 'GF');
    const vakBefore = vakTotal(s().vakStack);
    s().markHolidayTaken(id);
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore + 3.2); // +3.2h only
  });

  it('sets vakBucketId on the holiday event and adds bucket to vakStack', () => {
    initClean();
    const id = injectPending(`${YEAR}-08-20`);
    s().markHolidayTaken(id);
    const bucketId = s().holidayEvents.find((h) => h.id === id)!.vakBucketId;
    expect(bucketId).not.toBeNull();
    expect(s().vakStack.find((b) => b.id === bucketId)).toBeDefined();
  });
});

// ─── markHolidayExpired ─────────────────────────────────────────────────────

describe('markHolidayExpired', () => {
  it('transitions holiday status to EXPIRED', () => {
    initClean();
    // Inject a PENDING holiday so markHolidayExpired has something to act on
    const id = injectPending(`${YEAR}-09-10`, 'RF');
    s().markHolidayExpired(id);
    expect(s().holidayEvents.find((x) => x.id === id)!.status).toBe('EXPIRED');
  });

  it('does not change VAK stack or leave entries', () => {
    initClean();
    const vakBefore = vakTotal(s().vakStack);
    const leavesBefore = s().leaveEntries.length;
    const id = injectPending(`${YEAR}-09-10`, 'RF');
    s().markHolidayExpired(id);
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore);
    expect(s().leaveEntries.length).toBe(leavesBefore);
  });
});

// ─── addLeave ───────────────────────────────────────────────────────────────

describe('addLeave', () => {
  describe('source: VAK', () => {
    it('deducts exactly 8h from the VAK cascade', () => {
      initClean();
      const vakBefore = vakTotal(s().vakStack);
      s().addLeave(`${YEAR}-06-15`, 8, 'VAK');
      expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 8);
    });

    it('returns null (success) when VAK is sufficient', () => {
      initClean();
      const result = s().addLeave(`${YEAR}-06-15`, 8, 'VAK');
      expect(result).toBeNull();
    });

    it('returns an error string when VAK is insufficient', () => {
      initClean();
      const result = s().addLeave(`${YEAR}-06-15`, 9999, 'VAK');
      expect(typeof result).toBe('string');
      expect(result).toContain('Onvoldoende VAK');
    });

    it('does not change RV balance when using VAK', () => {
      initClean();
      const rvBefore = s().rvBalance;
      s().addLeave(`${YEAR}-06-15`, 8, 'VAK');
      expect(s().rvBalance).toBeCloseTo(rvBefore);
    });

  it('consumes expiring buckets before the WV (no-expiry) bucket', () => {
    initClean(2 * VAK_PER_DAY, 0); // 12.8h carry + holiday buckets, all expiring before WV
    const wvBefore = s().vakStack.find((b) => b.type === 'WV')!.hours;
    s().addLeave(`${YEAR}-01-15`, 8, 'VAK');
    const wvAfter = s().vakStack.find((b) => b.type === 'WV')!.hours;
    // WV should not be touched since there are expiring buckets available
    expect(wvAfter).toBeCloseTo(wvBefore);
  });    it('stores bucketsConsumed on the leave entry', () => {
      initClean();
      s().addLeave(`${YEAR}-06-15`, 8, 'VAK');
      const leave = s().leaveEntries[0];
      expect(leave.bucketsConsumed.length).toBeGreaterThan(0);
      expect(leave.bucketsConsumed.reduce((s, c) => s + c.hours, 0)).toBeCloseTo(8);
    });

    it('sets rvTransactionId to null for a pure VAK leave', () => {
      initClean();
      s().addLeave(`${YEAR}-06-15`, 8, 'VAK');
      expect(s().leaveEntries[0].rvTransactionId).toBeNull();
    });
  });

  describe('source: RV', () => {
    it('deducts exactly 8h from the RV balance', () => {
      initClean();
      const rvBefore = s().rvBalance;
      s().addLeave(`${YEAR}-06-15`, 8, 'RV');
      expect(s().rvBalance).toBeCloseTo(rvBefore - 8);
    });

    it('creates an RV deduction transaction', () => {
      initClean();
      s().addLeave(`${YEAR}-06-15`, 8, 'RV');
      const tx = s().rvTransactions.find((t) => t.deltaHours === -8);
      expect(tx).toBeDefined();
    });

    it('stores the rvTransactionId on the leave entry', () => {
      initClean();
      s().addLeave(`${YEAR}-06-15`, 8, 'RV');
      const leave = s().leaveEntries[0];
      expect(leave.rvTransactionId).not.toBeNull();
      const tx = s().rvTransactions.find((t) => t.id === leave.rvTransactionId);
      expect(tx).toBeDefined();
    });

    it('returns an error string when RV is insufficient', () => {
      s().resetAll();
      s().initYear(YEAR, REST_DAY, 0, 0);
      // Drain all RV first
      const rvBal = s().rvBalance;
      s().addLeave(`${YEAR}-06-01`, rvBal, 'RV');
      const result = s().addLeave(`${YEAR}-06-15`, 8, 'RV');
      expect(typeof result).toBe('string');
      expect(result).toContain('Onvoldoende RV');
    });

    it('does not touch the VAK stack when using RV', () => {
      initClean();
      const vakBefore = vakTotal(s().vakStack);
      s().addLeave(`${YEAR}-06-15`, 8, 'RV');
      expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore);
    });
  });

  describe('source: AUTO (cascade)', () => {
    it('uses VAK when sufficient', () => {
      initClean();
      const vakBefore = vakTotal(s().vakStack);
      const rvBefore = s().rvBalance;
      s().addLeave(`${YEAR}-06-15`, 8, 'AUTO');
      expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 8);
      expect(s().rvBalance).toBeCloseTo(rvBefore); // RV untouched
    });

    it('overflows to RV when VAK is exhausted mid-booking', () => {
      initClean();
      // Drain VAK down to 3h remaining
      const allVak = vakTotal(s().vakStack);
      s().addLeave(`${YEAR}-06-01`, allVak - 3, 'VAK');
      expect(vakTotal(s().vakStack)).toBeCloseTo(3);

      const rvBefore = s().rvBalance;
      s().addLeave(`${YEAR}-06-15`, 8, 'AUTO'); // 3h from VAK + 5h from RV
      expect(vakTotal(s().vakStack)).toBeCloseTo(0);
      expect(s().rvBalance).toBeCloseTo(rvBefore - 5);
    });

    it('stores rvTransactionId when RV overflow occurs', () => {
      initClean();
      const allVak = vakTotal(s().vakStack);
      s().addLeave(`${YEAR}-06-01`, allVak - 3, 'VAK');
      s().addLeave(`${YEAR}-06-15`, 8, 'AUTO');
      const leave = s().leaveEntries.find((l) => l.date === `${YEAR}-06-15`)!;
      expect(leave.rvTransactionId).not.toBeNull();
    });

    it('returns an error when neither VAK nor RV can cover the request', () => {
      s().resetAll();
      s().initYear(YEAR, REST_DAY, 0, 0);
      const allVak = vakTotal(s().vakStack);
      const allRv = s().rvBalance;
      s().addLeave(`${YEAR}-06-01`, allVak, 'VAK');
      s().addLeave(`${YEAR}-06-02`, allRv, 'RV');
      const result = s().addLeave(`${YEAR}-06-15`, 8, 'AUTO');
      expect(typeof result).toBe('string');
    });
  });

  it('returns an error for 0 or negative hours', () => {
    initClean();
    expect(s().addLeave(`${YEAR}-06-15`, 0, 'VAK')).not.toBeNull();
    expect(s().addLeave(`${YEAR}-06-15`, -1, 'VAK')).not.toBeNull();
  });

  it('leave entries are kept sorted by date', () => {
    initClean();
    s().addLeave(`${YEAR}-08-01`, 8, 'VAK');
    s().addLeave(`${YEAR}-06-01`, 8, 'VAK');
    s().addLeave(`${YEAR}-07-01`, 8, 'VAK');
    const dates = s().leaveEntries.map((l) => l.date);
    expect(dates).toEqual([...dates].sort());
  });
});

// ─── removeLeave ────────────────────────────────────────────────────────────

describe('removeLeave', () => {
  it('fully restores VAK buckets after removing a VAK leave', () => {
    initClean();
    const vakBefore = vakTotal(s().vakStack);
    s().addLeave(`${YEAR}-06-15`, 8, 'VAK');
    const leave = s().leaveEntries[0];
    s().removeLeave(leave.id);
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore);
  });

  it('fully restores RV balance after removing an RV leave', () => {
    initClean();
    const rvBefore = s().rvBalance;
    s().addLeave(`${YEAR}-06-15`, 8, 'RV');
    const leave = s().leaveEntries[0];
    s().removeLeave(leave.id);
    expect(s().rvBalance).toBeCloseTo(rvBefore);
  });

  it('removes the leave entry from the list', () => {
    initClean();
    s().addLeave(`${YEAR}-06-15`, 8, 'VAK');
    const leave = s().leaveEntries[0];
    s().removeLeave(leave.id);
    expect(s().leaveEntries.find((l) => l.id === leave.id)).toBeUndefined();
  });

  it('removes the linked RV transaction when removing an RV leave', () => {
    initClean();
    const txsBefore = s().rvTransactions.length;
    s().addLeave(`${YEAR}-06-15`, 8, 'RV');
    expect(s().rvTransactions.length).toBe(txsBefore + 1);
    const leave = s().leaveEntries[0];
    s().removeLeave(leave.id);
    // RV deduction transaction should be removed
    expect(s().rvTransactions.length).toBe(txsBefore);
  });

  it('does NOT accidentally remove an unrelated RV transaction on the same date', () => {
    initClean();
    // Book two separate RV leaves on the same date (shouldn't normally happen,
    // but tests that we use ID matching, not date/label matching)
    s().addLeave(`${YEAR}-06-15`, 4, 'RV');
    s().addLeave(`${YEAR}-06-15`, 4, 'RV');
    const leaveA = s().leaveEntries.find((l) => l.date === `${YEAR}-06-15`)!;
    const rvTxIdA = leaveA.rvTransactionId;
    s().removeLeave(leaveA.id);
    // The other transaction (for leave B) must still exist
    const txBStillExists = s().rvTransactions.some((tx) => tx.id !== rvTxIdA && tx.deltaHours < 0 && tx.date === `${YEAR}-06-15`);
    expect(txBStillExists).toBe(true);
  });

  it('restores the correct bucket hours when cascade consumed multiple buckets', () => {
    initClean(3 * VAK_PER_DAY, 0); // carry 19.2h expiring Feb 28, plus 166.4h WV
    // Take 24h — will consume all 19.2h CARRY_VAK + 4.8h from WV
    s().addLeave(`${YEAR}-01-20`, 24, 'VAK');
    const leave = s().leaveEntries[0];
    s().removeLeave(leave.id);
    const carry = s().vakStack.find((b) => b.type === 'CARRY_VAK')!;
    const wv = s().vakStack.find((b) => b.type === 'WV')!;
    expect(carry.hours).toBeCloseTo(3 * VAK_PER_DAY); // fully restored
    expect(wv.hours).toBeCloseTo(26 * 8 * 0.8);       // fully restored
  });

  it('is a no-op for a non-existent leave id', () => {
    initClean();
    const vakBefore = vakTotal(s().vakStack);
    s().removeLeave('non-existent-id');
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore);
  });
});

// ─── expireBuckets ──────────────────────────────────────────────────────────

describe('expireBuckets', () => {
  it('removes buckets whose expiresOn <= asOf', () => {
    initClean(3 * VAK_PER_DAY, 0); // CARRY_VAK expires 2026-02-28
    expect(s().vakStack.find((b) => b.type === 'CARRY_VAK')).toBeDefined();
    s().expireBuckets(`${YEAR}-03-01`); // one day after expiry
    expect(s().vakStack.find((b) => b.type === 'CARRY_VAK')).toBeUndefined();
  });

  it('keeps buckets that have not yet expired', () => {
    initClean(3 * VAK_PER_DAY, 0);
    s().expireBuckets(`${YEAR}-02-27`); // one day before expiry
    expect(s().vakStack.find((b) => b.type === 'CARRY_VAK')).toBeDefined();
  });

  it('moves expired buckets to expiredBuckets list with their remaining hours', () => {
    initClean(3 * VAK_PER_DAY, 0);
    s().expireBuckets(`${YEAR}-03-01`);
    const expired = s().expiredBuckets.find((b) => b.type === 'CARRY_VAK');
    expect(expired).toBeDefined();
    expect(expired!.hours).toBeCloseTo(3 * VAK_PER_DAY);
  });

  it('does not expire buckets with no expiresOn (WV base)', () => {
    initClean();
    s().expireBuckets('2099-12-31');
    expect(s().vakStack.find((b) => b.type === 'WV')).toBeDefined();
  });

  it('marks PENDING holidays as EXPIRED when their 6-week window has passed', () => {
    initClean();
    // All initYear holidays are TAKEN; inject a PENDING one to test expiry logic
    const pendingId = injectPending(`${YEAR}-01-01`);
    // Jan 1 + 6 weeks = Feb 12; run expiry on Feb 13
    s().expireBuckets(`${YEAR}-02-13`);
    expect(s().holidayEvents.find((h) => h.id === pendingId)!.status).toBe('EXPIRED');
  });

  it('does not expire TAKEN or already EXPIRED holidays', () => {
    initClean();
    const h = s().holidayEvents.find((h) => h.type === 'OF')!;
    s().markHolidayTaken(h.id);
    s().expireBuckets('2099-12-31');
    expect(s().holidayEvents.find((x) => x.id === h.id)!.status).toBe('TAKEN');
  });
});

// ─── removeHoliday ──────────────────────────────────────────────────────────

describe('removeHoliday', () => {
  it('removes the holiday event from the list', () => {
    initClean();
    const h = s().holidayEvents[0];
    s().removeHoliday(h.id);
    expect(s().holidayEvents.find((x) => x.id === h.id)).toBeUndefined();
  });

  it('also removes the linked VAK bucket if the holiday was TAKEN', () => {
    initClean();
    const h = s().holidayEvents.find((hh) => hh.type === 'OF')!;
    s().markHolidayTaken(h.id);
    const bucketId = s().holidayEvents.find((x) => x.id === h.id)!.vakBucketId!;
    // Note: the bucket is consumed by markHolidayTaken (leave cost),
    // but if it still has hours, removeHoliday should clean it up.
    s().removeHoliday(h.id);
    expect(s().holidayEvents.find((x) => x.id === h.id)).toBeUndefined();
    expect(s().vakStack.find((b) => b.id === bucketId)).toBeUndefined();
  });

  it('is a no-op for a non-existent holiday id', () => {
    initClean();
    const countBefore = s().holidayEvents.length;
    s().removeHoliday('non-existent');
    expect(s().holidayEvents.length).toBe(countBefore);
  });
});

// ─── resetAll ───────────────────────────────────────────────────────────────

describe('resetAll', () => {
  it('clears all state back to defaults', () => {
    initClean(3 * VAK_PER_DAY, 10);
    s().addLeave(`${YEAR}-06-15`, 8, 'VAK');
    s().resetAll();
    expect(s().settings.initialized).toBe(false);
    expect(s().vakStack).toHaveLength(0);
    expect(s().rvBalance).toBe(0);
    expect(s().leaveEntries).toHaveLength(0);
    expect(s().holidayEvents).toHaveLength(0);
  });
});
