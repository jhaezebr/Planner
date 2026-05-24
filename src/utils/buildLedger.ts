import type { VakBucket, RvTransaction, HolidayEvent, LeaveEntry, AppSettings } from '../types';
import { fmtHours } from './holidays';

export interface LedgerRow {
  id: string;
  date: string;
  type: string;
  description: string;
  vakDelta: number | null;
  vakBalance: number | null;
  rvDelta: number | null;
  rvBalance: number | null;
  expiry: string | null;
  note: string;
  rowClass: string;
}

type LedgerEvent = { date: string; kind: string; payload: unknown };

const KIND_ORDER: Record<string, number> = {
  INIT_BUCKET: 0,
  RV: 1,
  HOLIDAY: 2,
  HOLIDAY_EXP: 3,
  LEAVE: 4,
  HOLIDAY_EXPIRY_FORECAST: 5,
  EXPIRED_BUCKET: 6,
};

/**
 * Build a unified, sorted ledger from all store state slices.
 * This is a pure function — it has no side effects and can be called from any
 * component that needs the transaction history.
 */
export function buildLedger(
  vakStack: VakBucket[],
  rvTransactions: RvTransaction[],
  holidayEvents: HolidayEvent[],
  leaveEntries: LeaveEntry[],
  expiredBuckets: VakBucket[],
  settings: AppSettings,
): LedgerRow[] {
  const allEvents: LedgerEvent[] = [];

  // RV transactions — skip those linked to a leave entry (they appear in the LEAVE row)
  const leaveRvTxIds = new Set(leaveEntries.map((l) => l.rvTransactionId).filter(Boolean));
  for (const tx of rvTransactions) {
    if (!leaveRvTxIds.has(tx.id)) {
      allEvents.push({ date: tx.date, kind: 'RV', payload: tx });
    }
  }

  // Holiday events (taken / expired)
  for (const h of holidayEvents) {
    if (h.status === 'TAKEN') allEvents.push({ date: h.date, kind: 'HOLIDAY', payload: h });
    if (h.status === 'EXPIRED') allEvents.push({ date: h.date, kind: 'HOLIDAY_EXP', payload: h });
  }

  // Leave entries
  for (const l of leaveEntries) {
    allEvents.push({ date: l.date, kind: 'LEAVE', payload: l });
  }

  // Expired buckets
  for (const b of expiredBuckets) {
    allEvents.push({ date: b.expiresOn ?? b.addedOn, kind: 'EXPIRED_BUCKET', payload: b });
  }

  // Year initialisation buckets (WV / carry-overs)
  for (const b of [...vakStack, ...expiredBuckets]) {
    if (['WV', 'CARRY_VAK', 'CARRY_RV'].includes(b.type)) {
      allEvents.push({ date: b.addedOn, kind: 'INIT_BUCKET', payload: b });
    }
  }

  // Forecast expiry rows for buckets that still have remaining hours
  for (const b of vakStack) {
    if (b.expiresOn && b.hours > 0 && b.type !== 'WV') {
      allEvents.push({ date: b.expiresOn, kind: 'HOLIDAY_EXPIRY_FORECAST', payload: b });
    }
  }

  allEvents.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9);
  });

  const rows: LedgerRow[] = [];
  let runVak = 0;
  let runRv = 0;

  for (const ev of allEvents) {
    const { kind, payload, date } = ev;

    if (kind === 'INIT_BUCKET') {
      const b = payload as VakBucket;
      runVak += b.totalHours;
      rows.push({
        id: b.id, date, type: b.type,
        description: b.label,
        vakDelta: b.totalHours, vakBalance: runVak,
        rvDelta: null, rvBalance: runRv,
        expiry: b.expiresOn, note: '', rowClass: 'bg-blue-50',
      });

    } else if (kind === 'RV') {
      const tx = payload as RvTransaction;
      runRv = tx.balance;
      rows.push({
        id: tx.id, date, type: 'RV',
        description: tx.label,
        vakDelta: null, vakBalance: runVak,
        rvDelta: tx.deltaHours, rvBalance: runRv,
        expiry: null, note: '',
        rowClass: tx.deltaHours > 0 ? 'bg-cyan-50' : '',
      });

    } else if (kind === 'HOLIDAY') {
      const h = payload as HolidayEvent;
      const hrs = h.type === 'GF' ? 4 * (settings.workPct ?? 0.8) : 8 * (settings.workPct ?? 0.8);
      runVak += hrs;
      rows.push({
        id: h.id, date, type: h.type,
        description: `Feestdag toegekend: ${h.label}`,
        vakDelta: hrs, vakBalance: runVak,
        rvDelta: null, rvBalance: runRv,
        expiry: null, note: h.isRestDay ? 'Rustdag' : '',
        rowClass: 'bg-green-50',
      });

    } else if (kind === 'HOLIDAY_EXP') {
      const h = payload as HolidayEvent;
      rows.push({
        id: h.id + '-exp', date, type: h.type,
        description: `Feestdag vervallen: ${h.label}`,
        vakDelta: null, vakBalance: runVak,
        rvDelta: null, rvBalance: runRv,
        expiry: null, note: 'Vervallen',
        rowClass: 'bg-red-50 text-red-600',
      });

    } else if (kind === 'LEAVE') {
      const l = payload as LeaveEntry;
      const vakPart = l.bucketsConsumed.reduce((s, c) => s + c.hours, 0);
      runVak -= vakPart;
      runRv -= l.rvHoursConsumed;
      rows.push({
        id: l.id, date, type: 'LEAVE',
        description: `Verlof${l.note ? ` – ${l.note}` : ''}`,
        vakDelta: vakPart > 0 ? -vakPart : null, vakBalance: runVak,
        rvDelta: l.rvHoursConsumed > 0 ? -l.rvHoursConsumed : null, rvBalance: runRv,
        expiry: null, note: l.source, rowClass: '',
      });

    } else if (kind === 'HOLIDAY_EXPIRY_FORECAST') {
      const b = payload as VakBucket;
      rows.push({
        id: b.id + '-forecast', date, type: b.type,
        description: `Vervalt: ${b.label}`,
        vakDelta: -b.hours, vakBalance: runVak - b.hours,
        rvDelta: null, rvBalance: runRv,
        expiry: b.expiresOn, note: 'prognose',
        rowClass: 'bg-orange-50 text-orange-700 italic',
      });

    } else if (kind === 'EXPIRED_BUCKET') {
      const b = payload as VakBucket;
      runVak -= b.hours;
      rows.push({
        id: b.id + '-exp', date, type: b.type,
        description: `Bucket vervallen: ${b.label}`,
        vakDelta: -b.hours, vakBalance: runVak,
        rvDelta: null, rvBalance: runRv,
        expiry: b.expiresOn, note: `${fmtHours(b.hours)}u verloren`,
        rowClass: 'bg-red-50 text-red-700',
      });
    }
  }

  return rows;
}
