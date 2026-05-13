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
  addDays,
} from 'date-fns';
import { nl } from 'date-fns/locale';
import { usePlanStore } from '../store/usePlanStore';
import { fmtHours } from '../utils/holidays';
import { Badge } from '../components/Badge';
import type { HolidayType } from '../types';

const HOLIDAY_VARIANT: Record<HolidayType, 'OF' | 'DF' | 'RF' | 'VF' | 'GF'> = {
  OF: 'OF', DF: 'DF', RF: 'RF', VF: 'VF', GF: 'GF',
};

export function CalendarTab() {
  const { settings, holidayEvents, leaveEntries, vakStack } = usePlanStore();
  const [current, setCurrent] = useState(() => new Date(settings.year || new Date().getFullYear(), 0, 1));

  const today = new Date();
  const monthStart = startOfMonth(current);
  const monthEnd = endOfMonth(current);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Pad start (week starts on Monday, index 1)
  const startPad = (getDay(monthStart) + 6) % 7; // Mon=0
  const paddedDays: (Date | null)[] = [
    ...Array(startPad).fill(null),
    ...days,
  ];

  // Expiry warnings: collect dates where a bucket expires within 7 days
  const expiryWarningDates = new Set<string>();
  for (const b of vakStack) {
    if (!b.expiresOn) continue;
    const exp = parseISO(b.expiresOn);
    for (let i = 0; i < 7; i++) {
      expiryWarningDates.add(format(addDays(exp, -i), 'yyyy-MM-dd'));
    }
  }

  const getHolidaysOnDay = (d: Date) =>
    holidayEvents.filter((h) => isSameDay(parseISO(h.date), d));

  const getLeavesOnDay = (d: Date) =>
    leaveEntries.filter((e) => isSameDay(parseISO(e.date), d));

  const isRestDay = (d: Date) => getDay(d) === settings.restDay;
  const isWeekend = (d: Date) => { const wd = getDay(d); return wd === 0 || wd === 6; };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button className="btn-secondary" onClick={() => setCurrent(subMonths(current, 1))}>‹ Vorige</button>
        <h2 className="text-lg font-semibold text-gray-800 capitalize">
          {format(current, 'MMMM yyyy', { locale: nl })}
        </h2>
        <button className="btn-secondary" onClick={() => setCurrent(addMonths(current, 1))}>Volgende ›</button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        <Badge variant="OF">OF</Badge><span className="text-gray-500">Officieel</span>
        <Badge variant="DF">DF</Badge><span className="text-gray-500">Decreet</span>
        <Badge variant="RF">RF</Badge><span className="text-gray-500">Reglementair</span>
        <Badge variant="VF">VF</Badge><span className="text-gray-500">Vervangend</span>
        <Badge variant="GF">GF</Badge><span className="text-gray-500">Gentse feesten</span>
        <span className="inline-block w-3 h-3 rounded bg-amber-200 border border-amber-400 my-auto"></span>
        <span className="text-gray-500">Vervalt binnenkort</span>
        <span className="inline-block w-3 h-3 rounded bg-blue-100 border border-blue-300 my-auto"></span>
        <span className="text-gray-500">Verlof geboekt</span>
        <span className="inline-block w-3 h-3 rounded bg-gray-100 border border-gray-300 my-auto"></span>
        <span className="text-gray-500">Rustdag</span>
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
          const hasLeave = leaves.length > 0;
          const hasExpWarning = expiryWarningDates.has(dateStr);
          const isToday = isSameDay(d, today);

          let cellClass = 'rounded-lg border p-1 min-h-[80px] text-xs transition-colors ';
          if (isWeekend(d) || isRest) {
            cellClass += 'bg-gray-50 border-gray-200 ';
          } else if (hasLeave) {
            cellClass += 'bg-blue-50 border-blue-200 ';
          } else if (hasExpWarning) {
            cellClass += 'bg-amber-50 border-amber-300 ';
          } else {
            cellClass += 'bg-white border-gray-200 ';
          }
          if (isToday) cellClass += 'ring-2 ring-blue-400 ';

          return (
            <div key={dateStr} className={cellClass}>
              <div className={`font-semibold mb-0.5 ${isToday ? 'text-blue-600' : 'text-gray-600'}`}>
                {format(d, 'd')}
              </div>
              {isRest && <span className="text-[9px] text-gray-400 block">rustdag</span>}
              {holidays.map((h) => (
                <div key={h.id} className="mb-0.5">
                  <Badge variant={HOLIDAY_VARIANT[h.type]} size="xs">
                    {h.type} {h.status === 'EXPIRED' ? '✕' : h.status === 'TAKEN' ? '✓' : ''}
                  </Badge>
                  <span className="block text-[9px] text-gray-500 leading-tight truncate">{h.label}</span>
                </div>
              ))}
              {leaves.map((l) => (
                <div key={l.id} className="mt-0.5">
                  <Badge variant={l.source === 'RV' ? 'RV' : 'WV'} size="xs">
                    {l.source} {fmtHours(l.hours)}u
                  </Badge>
                </div>
              ))}
              {hasExpWarning && !hasLeave && (
                <span className="text-[9px] text-amber-600 block mt-0.5">⏰ verval</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
