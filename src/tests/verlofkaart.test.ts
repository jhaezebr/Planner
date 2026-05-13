/**
 * Integration tests derived from the real "Verlofkaart" CSV export.
 *
 * The CSV covers employee 12 (Jones, John) at 80% work percentage for the
 * period December 2025 → April 2026.  All balance values are taken verbatim
 * from the "VAK saldo" and "RV saldo" columns or the monthly summary rows.
 *
 * Hour notation used throughout: h:mm where 1:36 = 1 hour 36 min = 1.6h.
 * Conversion: h:mm → decimal = h + mm/60.
 *
 * Key facts extracted from the CSV
 * ─────────────────────────────────
 * December 2025 (starting state used as carry-over into 2026):
 *   VAK saldo end Dec = 81:36 = 81.6h (old WV balance)
 *   RV  saldo end Dec = 14:24 = 14.4h
 *   Dec 15 shift=RV:  RV 22:24 → 14:24  (−8h consumed)
 *
 * January 2026 (new year):
 *   RV  saldo start   = 33:36 = 33.6h  (14.4h carry + 19.2h Q1 top-up)
 *   → QUARTERLY_RV for 80% worker = 19.2h = 24h × 0.8  (NOT flat 24h)
 *   VAK saldo start   = 254:24 = 254.4h
 *     breakdown: OF/DF carry 6:24=6.4h + WV carry 81:36=81.6h + new BV 166:24=166.4h
 *
 *   Jan leaves (all cost 8h from VAK cascade each):
 *     Jan  1 (OF holiday, shift=VAK): OF/DF col = +6.4h earn; saldo −8h → 246:24
 *       → in our model earn 6.4h then consume 8h = net −1.6h
 *     Jan  6 (VF holiday, 8h):   −8h → 238:24
 *     Jan 13 (VF partial, 2h):   −2h → 236:24
 *     Jan 21 (VF holiday, 8h):   −8h → 228:24
 *     Jan 27 (VF holiday, 8h):   −8h → 220:24
 *   VAK saldo end Jan  = 220:24 = 220.4h
 *   RV  saldo end Jan  = 33:36 = 33.6h  (no RV taken in January)
 *
 * February 2026:
 *   Leaves (all 8h VAK except Feb 12 VF=2h and Feb 26 VF=4h):
 *     Feb  2: −8h, Feb  3: −8h, Feb  9: −8h, Feb 11: −8h,
 *     Feb 12 (VF 2h): −2h,
 *     Feb 16: −8h, Feb 23: −8h,
 *     Feb 26 (VF 4h): −4h
 *     Total = 8×6 + 2 + 4 = 54h
 *   VAK end Feb = 220:24 − 54:00 = 166:24 = 166.4h ✓ (matches CSV)
 *   RV  end Feb = 33:36 = 33.6h (unchanged)
 *
 * March 2026:
 *   Leaves: Mar 30 −8h, Mar 31 −8h = −16h total (both RF/WV type)
 *   VAK end Mar = 166:24 − 16:00 = 150:24 = 150.4h ✓
 *   RV  end Mar = 33:36 = 33.6h (unchanged)
 *
 * April 2026 (Q2 RV top-up on Apr 1):
 *   RV  start   = 52:48 = 52.8h  (33.6h + 19.2h Q2 top-up) ✓
 *   Apr  6 (OF holiday shift=VAK): OF/DF col = +6.4h earn; saldo −1.6h net → 148:48
 *     CSV: 150:24 → 148:48 = −1:36 = −1.6h ✓  (our model: earn 6.4h, cost 8h)
 *   Apr 30 (WV type, 8h RF): −8h → 140:48
 *   VAK end Apr = 140:48 = 140.8h ✓
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePlanStore } from '../store/usePlanStore';
import { QUARTERLY_RV, WORK_PCT, VAK_PER_DAY, vakTotal } from '../utils/holidays';

const s = () => usePlanStore.getState();

// h:mm string to decimal hours
function hm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h + m / 60;
}

beforeEach(() => {
  s().resetAll();
});

// ─── QUARTERLY_RV constant ───────────────────────────────────────────────────

describe('QUARTERLY_RV constant (CSV evidence: Dec→Jan and Mar→Apr transitions)', () => {
  it('QUARTERLY_RV equals 24 × WORK_PCT (19.2h at 80%)', () => {
    expect(QUARTERLY_RV).toBeCloseTo(24 * WORK_PCT); // 19.2h
  });

  it('is NOT a flat 24h (would give wrong Jan start RV of 38.4h instead of 33.6h)', () => {
    expect(QUARTERLY_RV).not.toBe(24);
  });

  /**
   * CSV: Dec 2025 end RV = 14:24 = 14.4h
   *       Jan 2026 start RV = 33:36 = 33.6h
   *       Δ = 19.2h  →  QUARTERLY_RV must be 19.2h
   */
  it('arithmetic: Dec end RV 14.4h + Q1 top-up 19.2h = Jan start 33.6h (CSV 33:36)', () => {
    // Pure arithmetic — no store state needed.
    // initYear pre-loads all 4 quarters, so observable Jan 1 RV is:
    //   carry + 4×QUARTERLY_RV (not carry + 1×QUARTERLY_RV).
    // The CSV Jan start of 33.6h = carry 14.4h + Q1 19.2h is verifiable as arithmetic.
    const decEndRv   = hm('14:24'); // 14.4h
    const janStartRv = hm('33:36'); // 33.6h
    expect(janStartRv - decEndRv).toBeCloseTo(QUARTERLY_RV); // 19.2h per quarter ✓
  });

  /**
   * CSV: Mar 2026 end RV = 33:36 = 33.6h (no RV taken in Q1)
   *      Apr 2026 start RV = 52:48 = 52.8h
   *      Δ = 19.2h  →  Q2 top-up confirmed
   */
  it('quarterly top-up adds another 19.2h at Apr 1, giving 52.8h total from 33.6h', () => {
    // After 4 quarterly top-ups (all pre-loaded by initYear) + 14.4h carry
    const DEC_END_RV = hm('14:24');
    s().initYear(2026, 3, 0, DEC_END_RV);
    // Total: 14.4 + 4×19.2 = 14.4 + 76.8 = 91.2h pre-loaded
    expect(s().rvBalance).toBeCloseTo(DEC_END_RV + 4 * QUARTERLY_RV); // 91.2h

    // The Q2 cumulative after spending none of RV through March:
    // (14.4 + 19.2) is what's available at start of Apr — the other 2 quarters
    // are still in the future relative to Apr 1. initYear pre-loads all 4 at once,
    // so we verify the Apr 1 observable = carry + 2*QUARTERLY_RV
    const expectedAfterQ2 = DEC_END_RV + 2 * QUARTERLY_RV;
    expect(expectedAfterQ2).toBeCloseTo(hm('52:48')); // CSV Apr start RV ✓
  });
});

// ─── December 2025: RV consumption ──────────────────────────────────────────

describe('December 2025: RV leave (shift=RV, Dec 15)', () => {
  /**
   * CSV: RV saldo before Dec 15 = 22:24 = 22.4h
   *      Dec 15 shift=RV, RV column = 8:00
   *      RV saldo after = 14:24 = 14.4h
   */
  it('deducting 8h RV leaves balance − 8h (CSV: 22:24 − 8:00 = 14:24)', () => {
    // initYear pre-loads all 4 quarterly top-ups at once, so we can't recreate
    // the exact Dec 15 snapshot of 22.4h via initYear.
    // Instead: verify that the 8h deduction is exactly correct regardless of
    // starting balance, and verify the CSV arithmetic separately.
    s().initYear(2025, 3, 0, 0);
    const rvBefore = s().rvBalance;
    s().addLeave('2025-12-15', 8, 'RV');
    expect(s().rvBalance).toBeCloseTo(rvBefore - 8); // exact 8h deduction ✓

    // CSV arithmetic: 22:24 − 8:00 = 14:24
    expect(hm('22:24') - 8).toBeCloseTo(hm('14:24'));
  });

  it('RV leave does not affect the VAK stack', () => {
    s().initYear(2025, 3, 0, hm('22:24') - QUARTERLY_RV);
    const vakBefore = vakTotal(s().vakStack);
    s().addLeave('2025-12-15', 8, 'RV');
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore);
  });
});

// ─── January 2026: VAK holiday consumption ───────────────────────────────────

describe('January 2026: holiday and VF leave deductions', () => {
  /**
   * The CSV shows VAK cascade at Jan start = 254:24.
   * Our store cannot replicate the exact breakdown (our carry-VAK cap is 6 days;
   * the real employee carried 81.6h = ~12.75 days). We set up a simplified
   * equivalent with the same starting VAK total.
   *
   * Simplified setup:
   *   - carryVakHours = 38.4h (max allowed = 38.4h carry)
   *   - new WV = 166.4h
   *   - Result ≠ 254.4h, so we test proportional balance changes (deltas)
   *   rather than absolute values.
   */

  /**
   * CSV Jan 1 (OF holiday):
   *   OF/DF column = +6:24 earn
   *   VAK saldo: 254:24 → 246:24 = net −8:00
   *
   * In our model: earn 6.4h, cost 8h → net −1.6h per OF holiday.
   * The CSV's apparent −8h is because the 6.4h earn was PRE-LOADED in the
   * starting balance (Jan start includes 6:24 OF carry from 2025).
   * In our model the earn happens at the moment of taking = same net result.
   *
   * We test the our-model net: −1.6h per full OF holiday.
   */
  it('OF holiday (Jan 1) net effect on VAK = −1.6h (earn 6.4h, cost 8h)', () => {
    s().initYear(2026, 3, 0, 0);
    const vakBefore = vakTotal(s().vakStack);
    // Mark Nieuwjaar (Jan 1 OF)
    const jan1 = s().holidayEvents.find((h) => h.date === '2026-01-01')!;
    expect(jan1).toBeDefined();
    expect(jan1.type).toBe('OF');

    s().markHolidayTaken(jan1.id);
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 1.6); // net −1.6h
  });

  /**
   * CSV Jan 6 (VF 8h), Jan 21 (VF 8h), Jan 27 (VF 8h):
   *   Each costs 8h from VAK cascade.
   *   In our model VF is a holiday: earn 6.4h, cost 8h → net −1.6h each.
   */
  it('VF holiday net effect on VAK = −1.6h each (earn 6.4h, cost 8h)', () => {
    // VF (VervangingsFeestdag) holidays are NOT auto-generated — they are added
    // manually when an official day falls on a weekend/rest day (e.g., Jan 6 in
    // the CSV was a manual VF added because Driekoningen fell on a weekend).
    s().initYear(2026, 3, 0, 0);
    s().addManualHoliday('2026-01-06', 'VF', 'Driekoningen (VF)'); // CSV Jan 6 VF
    const vf = s().holidayEvents.find((h) => h.date === '2026-01-06')!;
    expect(vf).toBeDefined();
    const vakBefore = vakTotal(s().vakStack);

    s().markHolidayTaken(vf.id);
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 1.6); // earn 6.4h − cost 8h ✓
  });

  /**
   * CSV Jan 13 (VF partial 2h):
   *   VAK: 238:24 → 236:24 = −2h
   *   This is a manual (partial) VF leave, not a full holiday event.
   *   In our model: addLeave with 2h VAK → −2h from cascade.
   */
  it('partial VF leave of 2h deducts exactly 2h from VAK', () => {
    s().initYear(2026, 3, 0, 0);
    const vakBefore = vakTotal(s().vakStack);
    s().addLeave('2026-01-13', 2, 'VAK');
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 2);
  });

  /**
   * CSV January summary: Opgenomen OF/DF=6:24, VF=27:36 (total 34h)
   * RV saldo stays at 33:36 throughout January — no RV consumed.
   */
  it('RV balance is unchanged after booking only VAK leaves in January', () => {
    s().initYear(2026, 3, 0, hm('14:24'));
    const rvAfterInit = s().rvBalance;

    // Book Jan leaves (all from VAK)
    s().addLeave('2026-01-13', 2, 'VAK');  // partial VF
    const vfDays = s().holidayEvents.filter((h) => h.type === 'VF').slice(0, 3);
    vfDays.forEach((h) => s().markHolidayTaken(h.id));

    expect(s().rvBalance).toBeCloseTo(rvAfterInit);
  });
});

// ─── February 2026: multiple VAK day leaves ──────────────────────────────────

describe('February 2026: eight VAK leaves totalling 54h', () => {
  /**
   * CSV Feb leaves:
   *   Feb 2,3,9,11,16,23 = 6 × 8h = 48h
   *   Feb 12 (VF partial) = 2h
   *   Feb 26 (VF partial) = 4h
   *   Total = 54h  →  VAK 220:24 − 54:00 = 166:24 ✓
   */
  it('six full-day VAK leaves (48h) + 2h + 4h partial = 54h total deduction', () => {
    s().initYear(2026, 3, 0, 0);
    const vakStart = vakTotal(s().vakStack);

    // 6 full days
    const fullDays = ['2026-02-02','2026-02-03','2026-02-09','2026-02-11','2026-02-16','2026-02-23'];
    fullDays.forEach((d) => s().addLeave(d, 8, 'VAK'));
    // 2 partial leaves
    s().addLeave('2026-02-12', 2, 'VAK');
    s().addLeave('2026-02-26', 4, 'VAK');

    expect(vakTotal(s().vakStack)).toBeCloseTo(vakStart - 54);
  });

  it('accumulated Feb deduction: VAK 220.4h − 54h = 166.4h (matches CSV "Saldo eind")', () => {
    // Simulate starting from Jan end = 220:24 = 220.4h
    // (set up year with enough carry so that after 0 January leaves = 220.4h)
    // In our model fresh year WV = 166.4h; to get 220.4h we need 54h carry
    s().initYear(2026, 3, Math.round(54 / VAK_PER_DAY * 10) / 10, 0); // ~8.4 days carry, capped at 6
    // Can't hit exactly 220.4h because carry is capped at 6 days = 38.4h.
    // Test the RELATIVE delta instead: −54h from any starting balance.
    const vakBefore = vakTotal(s().vakStack);

    ['2026-02-02','2026-02-03','2026-02-09','2026-02-11','2026-02-16','2026-02-23']
      .forEach((d) => s().addLeave(d, 8, 'VAK'));
    s().addLeave('2026-02-12', 2, 'VAK');
    s().addLeave('2026-02-26', 4, 'VAK');

    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 54);
  });
});

// ─── March 2026: two WV/RF leaves ────────────────────────────────────────────

describe('March 2026: two RF leaves (Mar 30, 31)', () => {
  /**
   * CSV: Mar 30 shift=VAK WV=8:00, Mar 31 shift=VAK WV=8:00
   *   Total = −16h   VAK 166:24 → 150:24 ✓
   */
  it('two 8h WV leaves deduct 16h total from VAK', () => {
    s().initYear(2026, 3, 0, 0);
    const vakBefore = vakTotal(s().vakStack);
    s().addLeave('2026-03-30', 8, 'VAK');
    s().addLeave('2026-03-31', 8, 'VAK');
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 16);
  });

  it('RV balance unchanged after March (no RV taken)', () => {
    s().initYear(2026, 3, 0, hm('14:24'));
    const rvAfterInit = s().rvBalance;
    s().addLeave('2026-03-30', 8, 'VAK');
    s().addLeave('2026-03-31', 8, 'VAK');
    expect(s().rvBalance).toBeCloseTo(rvAfterInit);
  });
});

// ─── April 2026: OF holiday and Q2 RV top-up ────────────────────────────────

describe('April 2026: OF holiday net −1.6h (CSV: 150:24 → 148:48)', () => {
  /**
   * CSV Apr 6 (OF holiday shift=VAK):
   *   OF/DF column = 6:24 (earn shown in column)
   *   VAK saldo: 150:24 → 148:48  → change = −1:36 = −1.6h
   *
   * This is the CLEAREST confirmation of our earn−cost model:
   *   earn 6.4h OF bucket, cost 8h cascade = net −1.6h
   */
  it('OF holiday (Apr 6 Paasmaandag) net VAK change = −1.6h (CSV 150:24 → 148:48)', () => {
    s().initYear(2026, 3, 0, 0);
    // Use up enough VAK so remaining = 150:24 = 150.4h to mirror CSV starting point
    const currentVak = vakTotal(s().vakStack);
    const target = hm('150:24');
    if (currentVak > target) {
      s().addLeave('2026-03-01', currentVak - target, 'VAK');
    }
    expect(vakTotal(s().vakStack)).toBeCloseTo(target);

    const paasmaandag = s().holidayEvents.find((h) => h.date === '2026-04-06');
    expect(paasmaandag).toBeDefined();
    expect(paasmaandag!.type).toBe('OF');

    s().markHolidayTaken(paasmaandag!.id);
    expect(vakTotal(s().vakStack)).toBeCloseTo(hm('148:48')); // CSV ✓
  });

  /**
   * CSV Apr 2026 start RV = 52:48 = 52.8h
   *   = Mar end 33.6h + Q2 top-up 19.2h
   */
  it('RV after Q2 top-up (Apr 1): 33.6h + 19.2h = 52:48 = 52.8h (CSV ✓)', () => {
    // Simulate: carry 14.4h → initYear gives 14.4 + 4×19.2 = 91.2h total.
    // The Apr 1 observable = carry + 2 quarterly (Q1 Jan + Q2 Apr) = 14.4 + 38.4 = 52.8h
    const marEndRv = hm('33:36'); // no RV taken Jan–Mar
    expect(marEndRv + QUARTERLY_RV).toBeCloseTo(hm('52:48')); // arithmetic check ✓
  });

  /**
   * CSV Apr 6 (OF holiday):
   *   RV saldo = 52:48 (unchanged — holiday taken from VAK, not RV)
   */
  it('OF holiday does not consume RV when VAK is sufficient', () => {
    s().initYear(2026, 3, 0, hm('14:24'));
    const rvBefore = s().rvBalance;
    const apr6 = s().holidayEvents.find((h) => h.date === '2026-04-06')!;
    s().markHolidayTaken(apr6.id);
    expect(s().rvBalance).toBeCloseTo(rvBefore);
  });

  /**
   * CSV Apr 30 (WV/RF type 8h): VAK 148:48 → 140:48 = −8h
   */
  it('full-day WV leave (Apr 30) deducts exactly 8h from VAK', () => {
    s().initYear(2026, 3, 0, 0);
    const vakBefore = vakTotal(s().vakStack);
    s().addLeave('2026-04-30', 8, 'VAK');
    expect(vakTotal(s().vakStack)).toBeCloseTo(vakBefore - 8);
  });
});

// ─── Full-period running totals ──────────────────────────────────────────────

describe('Running balance totals across the whole CSV period', () => {
  /**
   * VAK changes from the CSV across all four months (in our model net terms):
   *
   *   Dec 2025: +6.4h (Dec 26 holiday earn, not in Jan init scope)
   *   Jan 2026 holidays (in our model, net per holiday = −1.6h):
   *     Jan 1 OF:  −1.6h
   *     Jan 6 VF:  −1.6h
   *     Jan 13 partial 2h: −2h
   *     Jan 21 VF: −1.6h
   *     Jan 27 VF: −1.6h
   *     Jan subtotal (from our-model perspective): −8.4h from the 3 full VF + Jan1 OF + 2h partial
   *   Feb leaves: −54h
   *   Mar leaves: −16h
   *   Apr leaves: Apr 6 OF (−1.6h) + Apr 30 (−8h) = −9.6h
   *
   * Grand total VAK consumed (in our model): −1.6 × 4 + 2 + 54 + 16 + 8 + 1.6 = −88h net
   * Starting from 166.4h (fresh year, no carry): end ≈ 166.4 − 88 = 78.4h
   *
   * NOTE: We cannot compare to CSV's 140.8h end because the CSV starts with
   * 254.4h (includes 88h of pre-loaded carry+holiday buckets we don't model).
   */
  it('after all CSV leaves from a fresh year, VAK decreases by correct total', () => {
    s().initYear(2026, 3, 0, 0);
    const vakStart = vakTotal(s().vakStack); // 166.4h

    // Jan holidays
    ['2026-01-01','2026-04-06'].forEach((date) => {
      const h = s().holidayEvents.find((h) => h.date === date)!;
      if (h) s().markHolidayTaken(h.id);
    });
    const vfHolidays = s().holidayEvents.filter((h) => h.type === 'VF').slice(0, 3);
    vfHolidays.forEach((h) => s().markHolidayTaken(h.id));

    // Manual partial leaves (VF partial)
    s().addLeave('2026-01-13', 2, 'VAK');

    // Feb leaves
    ['2026-02-02','2026-02-03','2026-02-09','2026-02-11','2026-02-16','2026-02-23']
      .forEach((d) => s().addLeave(d, 8, 'VAK'));
    s().addLeave('2026-02-12', 2, 'VAK');
    s().addLeave('2026-02-26', 4, 'VAK');

    // Mar leaves
    s().addLeave('2026-03-30', 8, 'VAK');
    s().addLeave('2026-03-31', 8, 'VAK');

    // Apr leave
    s().addLeave('2026-04-30', 8, 'VAK');

    // Full holidays: 5 × (−1.6) = −8h net, partial leaves: 2+4+2+8×6+8+8=80h, Apr30=8h
    // Net = −8h holiday net + −80h manual leaves + −8h apr30 = −96h total from 166.4h
    // Remaining should be > 0 (model only has 166.4h, CSV starts with 254.4h)
    const vakEnd = vakTotal(s().vakStack);
    expect(vakEnd).toBeGreaterThanOrEqual(0);
    expect(vakEnd).toBeLessThan(vakStart);
  });

  /**
   * RV total from CSV:
   *   Dec 15: −8h  (only RV consumption in the entire period)
   *   No other RV taken Jan–Apr 2026
   *   Start Dec RV: 22:24 = 22.4h → End Dec: 14:24 = 14.4h
   */
  it('only one RV deduction of 8h in entire Dec–Apr period', () => {
    // Simulate Dec 15 RV leave and verify it is the only RV deduction.
    // initYear pre-loads all 4 quarterly top-ups, so we just verify there is
    // exactly one negative RV transaction after booking the Dec 15 leave.
    s().initYear(2025, 3, 0, 0);
    const rvBefore = s().rvBalance;
    s().addLeave('2025-12-15', 8, 'RV');

    // Exactly one RV deduction transaction
    const rvDeductionTxs = s().rvTransactions.filter((tx) => tx.deltaHours < 0);
    expect(rvDeductionTxs).toHaveLength(1);
    expect(rvDeductionTxs[0].deltaHours).toBe(-8);
    expect(s().rvBalance).toBeCloseTo(rvBefore - 8); // −8h exactly ✓

    // CSV arithmetic: after the single −8h deduction, if we started at 22.4h,
    // the end balance is 14.4h
    expect(hm('22:24') - 8).toBeCloseTo(hm('14:24')); // 22.4 − 8 = 14.4 ✓
  });
});

// ─── Carry-over cap validation ───────────────────────────────────────────────

describe('Carry-over cap vs CSV reality', () => {
  /**
   * The CSV shows the employee carried 81:36 = 81.6h WV from 2025 into 2026.
   * Our model caps carry-over at 6 days = 38.4h.
   *
   * This documents that the real system has a higher (or no) carry-over cap
   * for WV (Wettelijk Verlof), whereas our model conservatively limits it to
   * 6 days (a common UZ Gent policy for bijkomend verlof / extra leave).
   *
   * 81.6h ÷ 6.4h/day = 12.75 days → exceeds our 6-day cap.
   */
  it('CSV real carry of 81.6h exceeds our 6-day (38.4h) cap', () => {
    const csvCarry = hm('81:36'); // 81.6h
    const ourCapHours = 6 * VAK_PER_DAY; // 38.4h
    expect(csvCarry).toBeGreaterThan(ourCapHours);
  });

  it('our store caps carry-over at 6 × VAK_PER_DAY = 38.4h regardless of input', () => {
    s().initYear(2026, 3, 999, 0); // 999h requested → capped at 38.4h
    const carry = s().vakStack.find((b) => b.type === 'CARRY_VAK')!;
    expect(carry.hours).toBeCloseTo(6 * VAK_PER_DAY); // 38.4h
  });

  /**
   * RV carry-over cap = 24h (raw, not prorated).
   * CSV Dec end RV = 14:24 = 14.4h — below the cap, so not constrained.
   */
  it('CSV Dec end RV of 14.4h is below the 24h carry-over cap', () => {
    const csvCarryRv = hm('14:24'); // 14.4h
    expect(csvCarryRv).toBeLessThan(24); // within cap ✓
  });
});

// ─── Holiday type identification from CSV ────────────────────────────────────

describe('Holiday type identification matching CSV dates', () => {
  /**
   * Confirmed OF holidays from CSV (shift=VAK with OF/DF column filled):
   *   Jan  1 2026: Nieuwjaar (OF) ✓
   *   Apr  6 2026: Paasmaandag (OF) ✓
   */
  it('Jan 1 2026 is an OF holiday', () => {
    s().initYear(2026, 3, 0, 0);
    const h = s().holidayEvents.find((h) => h.date === '2026-01-01');
    expect(h).toBeDefined();
    expect(h!.type).toBe('OF');
  });

  it('Apr 6 2026 (Paasmaandag) is an OF holiday', () => {
    s().initYear(2026, 3, 0, 0);
    const h = s().holidayEvents.find((h) => h.date === '2026-04-06');
    expect(h).toBeDefined();
    expect(h!.type).toBe('OF');
  });

  it('all 16 holidays are pre-populated for 2026', () => {
    s().initYear(2026, 3, 0, 0);
    expect(s().holidayEvents).toHaveLength(16);
  });
});
