import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseISO, isAfter, getDay } from 'date-fns';
import type {
  AppState,
  AppSettings,
  VakBucket,
  HolidayEvent,
  HolidayType,
  BucketType,
  LeaveEntry,
  LeaveSource,
  RvTransaction,
} from '../types';
import {
  getVakExpiry,
  getHolidayVakHours,
  sortVakStack,
  isBucketExpired,
  vakTotal,
  WORK_PCT,
} from '../utils/holidays';
import type { VariableHolidayDates } from '../utils/holidays';
import { genId } from '../utils/genId';
import { consumeVak } from './consumeVak';
import { buildInitYearState } from './initYearState';

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
    workPct?: number,
    variableDates?: VariableHolidayDates,
  ) => void;
  updateSettings: (s: Partial<AppSettings>) => void;

  // Holidays
  markHolidayTaken: (holidayId: string) => void;
  markHolidayExpired: (holidayId: string) => void;
  addManualHoliday: (date: string, type: HolidayType, label: string) => void;
  addManualVakBucket: (date: string, type: BucketType, label: string, hours: number, expiresOn: string | null) => void;
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

      initYear: (year, restDay, carryVakHours, carryRvHours, workPct = WORK_PCT, variableDates?) => {
        const result = buildInitYearState(year, restDay, carryVakHours, carryRvHours, workPct, variableDates);
        set({
          settings: { year, workPct, restDay, initialized: true },
          ...result,
          leaveEntries: [],
          expiredBuckets: [],
        });
      },

      markHolidayTaken: (holidayId) => {
        const state = get();
        const holiday = state.holidayEvents.find((h) => h.id === holidayId);
        if (!holiday || holiday.status !== 'PENDING') return;

        const earnedHours = getHolidayVakHours(holiday, state.settings.workPct ?? WORK_PCT);
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
        const earnedHours = getHolidayVakHours(tempHoliday, settings.workPct ?? WORK_PCT);
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

      addManualVakBucket: (date, type, label, hours, expiresOn) => {
        const bucket: VakBucket = {
          id: genId(),
          label: label || `${type} (${date})`,
          type,
          hours,
          totalHours: hours,
          addedOn: date,
          expiresOn,
        };
        set((s) => ({ vakStack: sortVakStack([...s.vakStack, bucket]) }));
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
          const holidayBucketId = state.holidayEvents.find((h) => h.date === date && h.vakBucketId)?.vakBucketId;
          const { newStack, consumed } = consumeVak(state.vakStack, hours, date, holidayBucketId);
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
        const holidayBucketIdAuto = state.holidayEvents.find((h) => h.date === date && h.vakBucketId)?.vakBucketId;
        if (vakAvail >= hours) {
          const { newStack, consumed } = consumeVak(state.vakStack, hours, date, holidayBucketIdAuto);
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

        const { newStack, consumed } = consumeVak(state.vakStack, vakPart, date, holidayBucketIdAuto);
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
    { name: 'planpredict-store' },
  ),
);