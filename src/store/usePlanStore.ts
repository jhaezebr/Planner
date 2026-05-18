import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseISO, isAfter, getDay } from 'date-fns';
import type {
  AppState,
  AppSettings,
  VakBucket,
  HolidayEvent,
  HolidayType,
  LeaveEntry,
  LeaveSource,
  RvTransaction,
  BucketConsumption,
} from '../types';
import {
  generateHolidays,
  getVakExpiry,
  getHolidayVakHours,
  sortVakStack,
  isBucketExpired,
  vakTotal,
  WORK_PCT,
  HOURS_PER_DAY,
  QUARTERLY_RV,
  VAK_PER_DAY,
  MAX_CARRY_RV_HOURS,
  MAX_CARRY_VAK_HOURS,
} from '../utils/holidays';

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const defaultSettings: AppSettings = {
  year: new Date().getFullYear(),
  workPct: WORK_PCT,
  restDay: 3, // Wednesday default
  initialized: false,
};

const initialState: AppState = {
  settings: defaultSettings,
  vakStack: [],
  rvBalance: 0,
  rvTransactions: [],
  holidayEvents: [],
  leaveEntries: [],
  expiredBuckets: [],
};

interface PlanStore extends AppState {
  // Setup
  initYear: (
    year: number,
    restDay: number,
    carryVakHours: number,
    carryRvHours: number,
  ) => void;
  updateSettings: (s: Partial<AppSettings>) => void;

  // Holidays
  markHolidayTaken: (holidayId: string) => void;
  markHolidayExpired: (holidayId: string) => void;
  addManualHoliday: (date: string, type: HolidayType, label: string) => void;
  removeHoliday: (holidayId: string) => void;

  // Leave
  addLeave: (date: string, hours: number, source: LeaveSource, note?: string) => string | null;
  removeLeave: (leaveId: string) => void;

  // Maintenance
  expireBuckets: (asOf: string) => void;

  // IO
  exportData: () => string;
  importData: (json: string) => void;
  resetAll: () => void;
}

export const usePlanStore = create<PlanStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      updateSettings: (s) =>
        set((state) => ({ settings: { ...state.settings, ...s } })),

      initYear: (year, restDay, carryVakHours, carryRvHours) => {
        const wv = HOURS_PER_DAY * WORK_PCT * 26; // 166.4h base WV

        // --- VAK STACK (ordered: expiring first, WV base last) ---
        const vakStack: VakBucket[] = [];

        // 1. Carry-over VAK (expires Feb 28, soft (not) capped at MAX_CARRY_VAK_HOURS)
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

        // 2. Base WV (no expiry, always at bottom)
        vakStack.push({
          id: genId(),
          label: `Wettelijk verlof ${year} (26 dagen × ${WORK_PCT})`,
          type: 'WV',
          hours: wv,
          totalHours: wv,
          addedOn: `${year}-01-01`,
          expiresOn: null,
        });

        // --- RV TRANSACTIONS: carry-over + quarterly top-ups ---
        const rvTxs: RvTransaction[] = [];
        let rvBal = 0;

        // Carry-over RV from previous year (soft (not) capped at MAX_CARRY_RV_HOURS)
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
          rvBal += QUARTERLY_RV;
          rvTxs.push({
            id: genId(),
            date: q,
            deltaHours: QUARTERLY_RV,
            label: `Kwartaaltoewijzing RV`,
            balance: rvBal,
          });
        }

        // --- HOLIDAYS: auto-earn VAK buckets at year start ---
        const rawHolidays = generateHolidays(year, restDay);
        const holidayEvents: HolidayEvent[] = [];

        for (const h of rawHolidays) {
          const earnedHours = getHolidayVakHours(h);
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

        set({
          settings: {
            year,
            workPct: WORK_PCT,
            restDay,
            initialized: true,
          },
          vakStack: sortVakStack(vakStack),
          rvBalance: rvBal,
          rvTransactions: rvTxs,
          holidayEvents,
          leaveEntries: [],
          expiredBuckets: [],
        });
      },

      markHolidayTaken: (holidayId) => {
        const state = get();
        const holiday = state.holidayEvents.find((h) => h.id === holidayId);
        if (!holiday || holiday.status !== 'PENDING') return;

        const earnedHours = getHolidayVakHours(holiday);
        const expiresOn = getVakExpiry(holiday);

        const bucket: VakBucket = {
          id: genId(),
          label: `${holiday.label} (${holiday.date})`,
          type: holiday.type,
          hours: earnedHours,
          totalHours: earnedHours,
          addedOn: holiday.date,
          expiresOn,
        };

        set((s) => ({
          vakStack: sortVakStack([...s.vakStack, bucket]),
          holidayEvents: s.holidayEvents.map((h) =>
            h.id === holidayId
              ? { ...h, status: 'TAKEN', vakBucketId: bucket.id }
              : h,
          ),
        }));
      },

      markHolidayExpired: (holidayId) => {
        set((s) => ({
          holidayEvents: s.holidayEvents.map((h) =>
            h.id === holidayId ? { ...h, status: 'EXPIRED' } : h,
          ),
        }));
      },

      addManualHoliday: (date, type, label) => {
        const { settings } = get();
        const d = parseISO(date);
        const isRestDay = getDay(d) === settings.restDay;

        const tempHoliday: HolidayEvent = {
          id: genId(),
          date,
          type,
          label,
          status: 'PENDING',
          isRestDay,
          vakBucketId: null,
        };

        // Auto-earn the VAK bucket immediately
        const earnedHours = getHolidayVakHours(tempHoliday);
        const expiresOn = getVakExpiry(tempHoliday);
        const bucketId = genId();
        const bucket: VakBucket = {
          id: bucketId,
          label: `${label} (${date})`,
          type,
          hours: earnedHours,
          totalHours: earnedHours,
          addedOn: date,
          expiresOn,
        };
        const holiday: HolidayEvent = { ...tempHoliday, status: 'TAKEN', vakBucketId: bucketId };

        set((s) => ({
          vakStack: sortVakStack([...s.vakStack, bucket]),
          holidayEvents: [...s.holidayEvents, holiday].sort((a, b) =>
            a.date.localeCompare(b.date),
          ),
        }));
      },

      removeHoliday: (holidayId) => {
        const state = get();
        const holiday = state.holidayEvents.find((h) => h.id === holidayId);
        if (!holiday) return;

        // If it had a bucket, remove it too
        set((s) => ({
          holidayEvents: s.holidayEvents.filter((h) => h.id !== holidayId),
          vakStack: holiday.vakBucketId
            ? s.vakStack.filter((b) => b.id !== holiday.vakBucketId)
            : s.vakStack,
        }));
      },

      addLeave: (date, hours, source, note = '') => {
        if (hours <= 0) return 'Ongeldige uren';
        const state = get();

        if (source === 'RV') {
          if (state.rvBalance < hours) return `Onvoldoende RV: ${state.rvBalance.toFixed(2)}u beschikbaar`;
          const newBal = state.rvBalance - hours;
          const tx: RvTransaction = {
            id: genId(),
            date,
            deltaHours: -hours,
            label: `Verlof ${date}`,
            balance: newBal,
          };
          const entry: LeaveEntry = {
            id: genId(),
            date,
            hours,
            source: 'RV',
            bucketsConsumed: [],
            rvHoursConsumed: hours,
            rvTransactionId: tx.id,
            note,
          };
          set((s) => ({
            rvBalance: newBal,
            rvTransactions: [...s.rvTransactions, tx],
            leaveEntries: [...s.leaveEntries, entry].sort((a, b) => a.date.localeCompare(b.date)),
          }));
          return null;
        }

        if (source === 'VAK') {
          const total = vakTotal(state.vakStack.filter((b) => b.addedOn <= date));
          if (total < hours) return `Onvoldoende VAK: ${total.toFixed(2)}u beschikbaar`;
          const { newStack, consumed } = consumeVak(state.vakStack, hours, date);
          const entry: LeaveEntry = {
            id: genId(), date, hours, source: 'VAK',
            bucketsConsumed: consumed, rvHoursConsumed: 0, rvTransactionId: null, note,
          };
          set((s) => ({
            vakStack: sortVakStack(newStack),
            leaveEntries: [...s.leaveEntries, entry].sort((a, b) => a.date.localeCompare(b.date)),
          }));
          return null;
        }

        // AUTO: try VAK first, then overflow to RV
        const vakAvail = vakTotal(state.vakStack.filter((b) => b.addedOn <= date));
        if (vakAvail >= hours) {
          const { newStack, consumed } = consumeVak(state.vakStack, hours, date);
          const entry: LeaveEntry = {
            id: genId(), date, hours, source: 'AUTO',
            bucketsConsumed: consumed, rvHoursConsumed: 0, rvTransactionId: null, note,
          };
          set((s) => ({
            vakStack: sortVakStack(newStack),
            leaveEntries: [...s.leaveEntries, entry].sort((a, b) => a.date.localeCompare(b.date)),
          }));
          return null;
        }

        const vakPart = vakAvail;
        const rvPart = hours - vakPart;
        if (state.rvBalance < rvPart) {
          return `Onvoldoende saldo: VAK ${vakAvail.toFixed(2)}u + RV ${state.rvBalance.toFixed(2)}u < ${hours}u benodigd`;
        }

        const { newStack, consumed } = consumeVak(state.vakStack, vakPart, date);
        const newBal = state.rvBalance - rvPart;
        const tx: RvTransaction = {
          id: genId(), date, deltaHours: -rvPart,
          label: `Verlof ${date} (overflow)`, balance: newBal,
        };
        const entry: LeaveEntry = {
          id: genId(), date, hours, source: 'AUTO',
          bucketsConsumed: consumed, rvHoursConsumed: rvPart, rvTransactionId: tx.id, note,
        };
        set((s) => ({
          vakStack: sortVakStack(newStack),
          rvBalance: newBal,
          rvTransactions: [...s.rvTransactions, tx],
          leaveEntries: [...s.leaveEntries, entry].sort((a, b) => a.date.localeCompare(b.date)),
        }));
        return null;
      },

      removeLeave: (leaveId) => {
        const state = get();
        const entry = state.leaveEntries.find((e) => e.id === leaveId);
        if (!entry) return;

        // Restore VAK buckets to their state before this entry was booked
        const vakStack = state.vakStack.map((b) => {
          const c = entry.bucketsConsumed.find((x) => x.bucketId === b.id);
          return c ? { ...b, hours: b.hours + c.hours } : b;
        });

        // Restore RV balance and remove the exact RV transaction that was created for this entry
        const newRvBal = state.rvBalance + entry.rvHoursConsumed;
        const rvTxs = entry.rvTransactionId
          ? state.rvTransactions.filter((tx) => tx.id !== entry.rvTransactionId)
          : state.rvTransactions;

        set({
          vakStack: sortVakStack(vakStack),
          rvBalance: newRvBal,
          rvTransactions: rvTxs,
          leaveEntries: state.leaveEntries.filter((e) => e.id !== leaveId),
        });
      },

      expireBuckets: (asOf) => {
        const state = get();
        const expired: VakBucket[] = [];
        const remaining: VakBucket[] = [];

        for (const b of state.vakStack) {
          if (isBucketExpired(b, asOf) && b.hours > 0) {
            expired.push({ ...b });
            // Keep as zero so the ID still lives in history
            remaining.push({ ...b, hours: 0 });
          } else {
            remaining.push(b);
          }
        }

        set((s) => ({
          vakStack: remaining.filter((b) => b.hours > 0),
          expiredBuckets: [...s.expiredBuckets, ...expired],
          holidayEvents: s.holidayEvents.map((h) => {
            if (h.status !== 'PENDING') return h;
            const exp = getVakExpiry(h);
            if (exp && !isAfter(parseISO(exp), parseISO(asOf))) {
              return { ...h, status: 'EXPIRED' };
            }
            return h;
          }),
        }));
      },

      exportData: () => JSON.stringify(get(), null, 2),

      importData: (json) => {
        try {
          const data = JSON.parse(json) as AppState;
          set({ ...data });
        } catch {
          alert('Ongeldig JSON bestand');
        }
      },

      resetAll: () => set({ ...initialState }),
    }),
    {
      name: 'planpredict-store',
    },
  ),
);

// Helper: consume `hours` from VAK stack (nearest expiry first), returns new stack + consumption log
function consumeVak(
  stack: VakBucket[],
  hours: number,
  asOf: string,
): { newStack: VakBucket[]; consumed: BucketConsumption[] } {
  const sorted = sortVakStack(stack);
  const newStack = sorted.map((b) => ({ ...b }));
  const consumed: BucketConsumption[] = [];
  let remaining = hours;

  for (const b of newStack) {
    if (remaining <= 0) break;
    if (b.hours <= 0) continue;
    // Only consume buckets that have been earned by the leave date
    if (b.addedOn > asOf) continue;
    const take = Math.min(b.hours, remaining);
    consumed.push({ bucketId: b.id, bucketLabel: b.label, hours: take });
    b.hours -= take;
    remaining -= take;
  }

  return { newStack, consumed };
}
