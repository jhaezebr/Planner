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
import { HOURS_PER_DAY, VAK_PER_DAY, QUARTERLY_RV, vakTotal } from '../utils/holidays';

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

  it('pre-populates 16 holiday events all with PENDING status', () => {
    initClean();
    expect(s().holidayEvents).toHaveLength(16);
    expect(s().holidayEvents.every((h) => h.status === 'PENDING')).toBe(true);
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
    expect(s().vakStack[0].type).toBe('CARRY_VAK');
    expect(s().vakStack[s().vakStack.length - 1].type).toBe('WV');
  });
});

// ─── markHolidayTaken ───────────────────────────────────────────────────────

describe('markHolidayTaken', () => {
  it('transitions holiday status from PENDING to TAKEN', () => {
    initClean();
    const h = s().holidayEvents.find((h) => h.type === 'OF')!;
    s().markHolidayTaken(h.id);
    expect(s().holidayEvents.find((x) => x.id === h.id)!.status).toBe('TAKEN');
  });

  it('adds a VAK bucket with earned hours = 8h × 80% = 6.4h', () => {
    initClean();
    const vakBefore = vakTotal(s().vakStack);
    const h = s().holidayEvents.find((h) => h.type === 'OF')!;
    s().markHolidayTaken(h.id);
    // Net change: +6.4h earned − 8h cost = −1.6h
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 1.6);
  });

  it('deducts the leave cost (8h) from VAK via cascade', () => {
    initClean();
    const h = s().holidayEvents.find((h) => h.date === `${YEAR}-05-01`)!; // Dag van de Arbeid
    const vakBefore = vakTotal(s().vakStack);
    s().markHolidayTaken(h.id);
    // +6.4 earned, −8 cost → net −1.6
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 1.6);
  });

  it('creates a leave entry linked to the holiday', () => {
    initClean();
    const h = s().holidayEvents.find((h) => h.type === 'OF')!;
    s().markHolidayTaken(h.id);
    const leave = s().leaveEntries.find((l) => l.date === h.date);
    expect(leave).toBeDefined();
    expect(leave!.hours).toBe(HOURS_PER_DAY); // 8h cost
    expect(leave!.note).toContain(h.label);
  });

  it('GF half-day earns 3.2h and costs 4h', () => {
    initClean();
    const gf = s().holidayEvents.find((h) => h.type === 'GF')!;
    const vakBefore = vakTotal(s().vakStack);
    s().markHolidayTaken(gf.id);
    // +3.2h earned − 4h cost = −0.8h
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 0.8);
    const leave = s().leaveEntries.find((l) => l.date === gf.date);
    expect(leave!.hours).toBe(4);
  });

  it('is a no-op when called on an already TAKEN holiday', () => {
    initClean();
    const h = s().holidayEvents.find((h) => h.type === 'OF')!;
    s().markHolidayTaken(h.id);
    const vakAfterFirst = vakTotal(s().vakStack);
    s().markHolidayTaken(h.id); // second call — should do nothing
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakAfterFirst);
    expect(s().leaveEntries.filter((l) => l.date === h.date)).toHaveLength(1);
  });

  it('overflows to RV when VAK stack is empty', () => {
    // Use up all VAK first, leaving 0 VAK
    s().initYear(YEAR, REST_DAY, 0, 0);
    // Drain the entire WV bucket by removing it
    const wvBucket = s().vakStack.find((b) => b.type === 'WV')!;
    // Simulate zero VAK by re-initialising with 0 and forcibly draining
    // Easiest approach: book leave for all 26 days to drain VAK
    // Instead, directly test the overflow path by booking 167h of leave
    // (which will consume all 166.4h WV and force 0.6h overflow)
    const allVak = vakTotal(s().vakStack);
    s().addLeave(`${YEAR}-06-01`, allVak, 'VAK'); // drain all VAK
    expect(vakTotal(s().vakStack)).toBeCloseTo(0);

    const rvBefore = s().rvBalance;
    const h = s().holidayEvents.find((h) => h.type === 'OF' && h.date > `${YEAR}-06-01`)!;
    s().markHolidayTaken(h.id);
    // VAK earned = 6.4h, cost = 8h → overflow 8 − 6.4 = 1.6h from RV
    expect(s().rvBalance).toBeCloseTo(rvBefore - 1.6);
  });
});

// ─── markHolidayExpired ─────────────────────────────────────────────────────

describe('markHolidayExpired', () => {
  it('transitions holiday status to EXPIRED', () => {
    initClean();
    const h = s().holidayEvents.find((h) => h.type === 'RF')!;
    s().markHolidayExpired(h.id);
    expect(s().holidayEvents.find((x) => x.id === h.id)!.status).toBe('EXPIRED');
  });

  it('does not add any VAK bucket or leave entry', () => {
    initClean();
    const vakBefore = vakTotal(s().vakStack);
    const leavesBefore = s().leaveEntries.length;
    const h = s().holidayEvents[0];
    s().markHolidayExpired(h.id);
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

  it('consumes the carry-over VAK bucket (nearest expiry) first', () => {
    initClean(2 * VAK_PER_DAY, 0); // 12.8h carry expiring Feb 28
    s().addLeave(`${YEAR}-01-15`, 8, 'VAK');
    const carry = s().vakStack.find((b) => b.type === 'CARRY_VAK')!;
    // 12.8h − 8h = 4.8h remaining in carry bucket
    expect(carry.hours).toBeCloseTo(12.8 - 8);
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
    const nieuwjaar = s().holidayEvents.find((h) => h.date === `${YEAR}-01-01`)!;
    expect(nieuwjaar.status).toBe('PENDING');
    // Nieuwjaar + 6 weeks = Feb 12; run expiry on Feb 13
    s().expireBuckets(`${YEAR}-02-13`);
    expect(s().holidayEvents.find((h) => h.id === nieuwjaar.id)!.status).toBe('EXPIRED');
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
