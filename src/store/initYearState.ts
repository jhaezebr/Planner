import type { VakBucket, HolidayEvent, RvTransaction } from '../types';
import { generateHolidays, getVakExpiry, HOURS_PER_DAY, sortVakStack } from '../utils/holidays';
import type { VariableHolidayDates } from '../utils/holidays';
import { genId } from '../utils/genId';

export interface InitYearResult {
  vakStack: VakBucket[];
  rvBalance: number;
  rvTransactions: RvTransaction[];
  holidayEvents: HolidayEvent[];
}

/**
 * Pure function that computes the initial state for a given year configuration.
 * Extracted from the `initYear` store action so the logic can be tested and
 * reasoned about in isolation.
 */
export function buildInitYearState(
  year: number,
  restDay: number,
  carryVakHours: number,
  carryRvHours: number,
  workPct: number,
  variableDates?: VariableHolidayDates,
): InitYearResult {
  const wv = HOURS_PER_DAY * workPct * 26;
  const quarterlyRv = 24 * workPct;
  const vakPerDay = HOURS_PER_DAY * workPct;

  // ── VAK stack ────────────────────────────────────────────────────────────
  const vakStack: VakBucket[] = [];

  // 1. Carry-over VAK (expires Feb 28)
  if (carryVakHours > 0) {
    vakStack.push({
      id: genId(),
      label: `Overdracht VAK ${year - 1}`,
      type: 'CARRY_VAK',
      hours: carryVakHours,
      totalHours: carryVakHours,
      addedOn: `${year}-01-01`,
      expiresOn: `${year}-02-28`,
    });
  }

  // 2. Base WV — no expiry, always at the bottom of the cascade
  vakStack.push({
    id: genId(),
    label: `Wettelijk verlof ${year} (26 dagen × ${workPct})`,
    type: 'WV',
    hours: wv,
    totalHours: wv,
    addedOn: `${year}-01-01`,
    expiresOn: null,
  });

  // ── RV transactions ──────────────────────────────────────────────────────
  const rvTxs: RvTransaction[] = [];
  let rvBal = 0;

  if (carryRvHours > 0) {
    rvBal += carryRvHours;
    rvTxs.push({
      id: genId(),
      date: `${year}-01-01`,
      deltaHours: carryRvHours,
      label: `Overdracht RV ${year - 1}`,
      balance: rvBal,
    });
  }

  const quarters = [`${year}-01-01`, `${year}-04-01`, `${year}-07-01`, `${year}-10-01`];
  for (const q of quarters) {
    rvBal += quarterlyRv;
    rvTxs.push({
      id: genId(),
      date: q,
      deltaHours: quarterlyRv,
      label: 'Kwartaaltoewijzing RV',
      balance: rvBal,
    });
  }

  // ── Holidays — auto-earn VAK buckets at year start ───────────────────────
  const rawHolidays = generateHolidays(year, restDay, variableDates);
  const holidayEvents: HolidayEvent[] = [];

  for (const h of rawHolidays) {
    const earnedHours = h.type === 'GF' ? (HOURS_PER_DAY / 2) * workPct : vakPerDay;
    const expiresOn = getVakExpiry(h);
    const bucketId = genId();

    vakStack.push({
      id: bucketId,
      label: `${h.label} (${h.date})`,
      type: h.type,
      hours: earnedHours,
      totalHours: earnedHours,
      addedOn: h.date,
      expiresOn,
    });

    holidayEvents.push({ ...h, status: 'TAKEN', vakBucketId: bucketId });
  }

  return {
    vakStack: sortVakStack(vakStack),
    rvBalance: rvBal,
    rvTransactions: rvTxs,
    holidayEvents,
  };
}
