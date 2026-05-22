import { useState } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isSameDay,
  parseISO,
  addMonths,
  subMonths,
} from 'date-fns';
import { nl } from 'date-fns/locale';
import { usePlanStore } from '../store/usePlanStore';
import { fmtHours, HOURS_PER_DAY } from '../utils/holidays';
import { Badge } from '../components/Badge';
import type { HolidayType } from '../types';

const HOLIDAY_VARIANT: Record<HolidayType, 'OF' | 'DF' | 'RF' | 'VF' | 'GF'> = {
  OF: 'OF', DF: 'DF', RF: 'RF', VF: 'VF', GF: 'GF',
};

export function CalendarTab() {
  const store = usePlanStore();
  const { settings, holidayEvents, leaveEntries, vakStack } = store;
  const [current, setCurrent] = useState(() => new Date(settings.year || new Date().getFullYear(), 0, 1));

  const today = new Date();
  const monthStart = startOfMonth(current);
  const monthEnd = endOfMonth(current);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Pad start (week starts on Monday)
  const startPad = (getDay(monthStart) + 6) % 7;
  const paddedDays: (Date | null)[] = [
    ...Array(startPad).fill(null),
    ...days,
  ];

  // Expiry warnings: only the exact expiry date, so each bucket gets exactly one ⏰ day
  const expiryWarningDates = new Set<string>();   // buckets with hours > 0
  const expiryDepletedDates = new Set<string>();  // buckets fully used up (hours = 0)
  const expiryWarningLabels = new Map<string, string[]>();
  for (const b of vakStack) {
    if (!b.expiresOn) continue;
    const existing = expiryWarningLabels.get(b.expiresOn) ?? [];
    if (b.hours > 0) {
      expiryWarningDates.add(b.expiresOn);
      existing.push(`${b.label}: ${fmtHours(b.hours)}u`);
    } else {
      expiryDepletedDates.add(b.expiresOn);
      existing.push(`${b.label}: volledig opgebruikt`);
    }
    expiryWarningLabels.set(b.expiresOn, existing);
  }

  const getHolidaysOnDay = (d: Date) =>
    holidayEvents.filter((h) => isSameDay(parseISO(h.date), d));

  const getLeavesOnDay = (d: Date) =>
    leaveEntries.filter((e) => isSameDay(parseISO(e.date), d));

  const isRestDay = (d: Date) => getDay(d) === settings.restDay;
  const isWeekend = (d: Date) => { const wd = getDay(d); return wd === 0 || wd === 6; };

  // Click cycle: no leave → VAK → RV → remove
  const handleDayClick = (dateStr: string, d: Date) => {
    if (!settings.initialized) return;
    if (isWeekend(d) || isRestDay(d)) return;

    const existingLeaves = leaveEntries.filter((e) => e.date === dateStr);

    if (existingLeaves.length === 0) {
      // Cycle step 1: try VAK, fall through to RV if insufficient
      const errVak = store.addLeave(dateStr, HOURS_PER_DAY, 'VAK');
      if (errVak) {
        // Not enough VAK — skip straight to RV
        const errRv = store.addLeave(dateStr, HOURS_PER_DAY, 'RV');
        if (errRv) {
          // Neither available — stay empty, no message
        }
      }
    } else {
      const current = existingLeaves[0];
      const isVak = current.source === 'VAK' || (current.source === 'AUTO' && current.rvHoursConsumed === 0);
      if (isVak) {
        // Cycle step 2: switch to RV
        store.removeLeave(current.id);
        const errRv = store.addLeave(dateStr, HOURS_PER_DAY, 'RV');
        if (errRv) {
          // Not enough RV — skip to empty (leave already removed)
        }
      } else {
        // Cycle step 3: remove, back to empty
        store.removeLeave(current.id);
      }
    }
  };

  return (
    <div className="p-4">
      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button className="btn-secondary" onClick={() => setCurrent(subMonths(current, 1))}>‹ Vorige</button>
        <h2 className="text-lg font-semibold text-gray-800 capitalize">
          {format(current, 'MMMM yyyy', { locale: nl })}
        </h2>
        <button className="btn-secondary" onClick={() => setCurrent(addMonths(current, 1))}>Volgende ›</button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-4 text-xs items-center">
        <Badge variant="OF">OF</Badge><span className="text-gray-500">Officieel</span>
        <Badge variant="DF">DF</Badge><span className="text-gray-500">Decreet</span>
        <Badge variant="RF">RF</Badge><span className="text-gray-500">Reglementair</span>
        <Badge variant="VF">VF</Badge><span className="text-gray-500">Vervangend</span>
        <Badge variant="GF">GF</Badge><span className="text-gray-500">Gentse feesten</span>
        <span className="inline-block w-3 h-3 rounded bg-blue-100 border border-blue-300"></span>
        <span className="text-gray-500">VAK verlof</span>
        <span className="inline-block w-3 h-3 rounded bg-cyan-100 border border-cyan-300"></span>
        <span className="text-gray-500">RV verlof</span>
        <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-300"></span>
        <span className="text-gray-500">Vervalt binnenkort</span>
        <span className="ml-2 text-gray-400 italic">Klik op een dag: leeg → VAK → RV → leeg</span>
      </div>

      {/* Day headers (Mon–Sun) */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map((d) => (
          <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {paddedDays.map((d, i) => {
          if (!d) return <div key={`pad-${i}`} />;

          const dateStr = format(d, 'yyyy-MM-dd');
          const holidays = getHolidaysOnDay(d);
          const leaves = getLeavesOnDay(d);
          const isRest = isRestDay(d) && !isWeekend(d);
          const isWknd = isWeekend(d);
          const hasLeave = leaves.length > 0;
          const hasRvLeave = leaves.some((l) => l.source === 'RV' || l.rvHoursConsumed > 0);
          const hasExpWarning = expiryWarningDates.has(dateStr);
          const hasExpDepleted = !hasExpWarning && expiryDepletedDates.has(dateStr);
          const isToday = isSameDay(d, today);
          const isClickable = settings.initialized && !isWknd && !isRest;

          let cellClass = 'rounded-lg border p-1 min-h-[80px] text-xs transition-colors select-none ';
          if (hasExpWarning) {
            cellClass += 'bg-amber-50 border-amber-300 ';
          } else if (hasRvLeave) {
            cellClass += 'bg-cyan-50 border-cyan-300 ';
          } else if (hasLeave) {
            cellClass += 'bg-blue-50 border-blue-200 ';
          } else if (isWknd || isRest) {
            cellClass += 'bg-gray-50 border-gray-200 ';
          } else {
            cellClass += 'bg-white border-gray-200 ';
          }
          if (isToday) cellClass += 'ring-2 ring-blue-400 ';
          if (isClickable) cellClass += 'cursor-pointer hover:brightness-95 active:brightness-90 ';

          return (
            <div
              key={dateStr}
              className={cellClass}
              onClick={() => handleDayClick(dateStr, d)}
              title={isClickable ? 'Klik: leeg → VAK → RV → leeg' : undefined}
            >
              <div className={`font-semibold mb-0.5 ${isToday ? 'text-blue-600' : 'text-gray-600'}`}>
                {format(d, 'd')}
              </div>
              {isRest && <span className="text-[9px] text-gray-400 block">rustdag</span>}
              {holidays.map((h) => (
                <div key={h.id} className="mb-0.5">
                  <Badge variant={HOLIDAY_VARIANT[h.type]} size="xs">
                    {h.type}
                  </Badge>
                  <span className="block text-[9px] text-gray-500 leading-tight truncate">{h.label}</span>
                </div>
              ))}
              {leaves.map((l) => (
                <div key={l.id} className="mt-0.5">
                  <Badge variant={l.source === 'RV' || l.rvHoursConsumed > 0 ? 'RV' : 'WV'} size="xs">
                    {l.source === 'RV' || l.rvHoursConsumed > 0 ? 'RV' : 'VAK'} {fmtHours(l.hours)}u
                  </Badge>
                </div>
              ))}
              {(hasExpWarning || hasExpDepleted) && !hasLeave && (
                <span
                  className={`text-[9px] block mt-0.5 cursor-help ${
                    hasExpDepleted
                      ? 'text-gray-400 line-through'
                      : 'text-amber-600'
                  }`}
                  title={expiryWarningLabels.get(dateStr)?.join('\n')}
                >{hasExpDepleted ? '⏰ verval' : '⏰ verval'}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary cards */}
      {settings.initialized && (
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
            <p className="text-[10px] text-blue-500 uppercase tracking-wide font-medium">VAK saldo</p>
            <p className="text-lg font-bold text-blue-800 mt-0.5">{fmtHours(vakStack.reduce((s, b) => s + b.hours, 0))} u</p>
            <p className="text-[10px] text-blue-500">{(vakStack.reduce((s, b) => s + b.hours, 0) / 8).toFixed(1)} d</p>
          </div>
          <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3 text-center">
            <p className="text-[10px] text-cyan-500 uppercase tracking-wide font-medium">RV saldo</p>
            <p className="text-lg font-bold text-cyan-800 mt-0.5">{fmtHours(store.rvBalance)} u</p>
            <p className="text-[10px] text-cyan-500">{(store.rvBalance / 8).toFixed(1)} d</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">Verloven</p>
            <p className="text-lg font-bold text-gray-800 mt-0.5">{store.leaveEntries.length}</p>
            <p className="text-[10px] text-gray-500">{fmtHours(store.leaveEntries.reduce((s, l) => s + l.hours, 0))} u</p>
          </div>
        </div>
      )}
    </div>
  );
}
