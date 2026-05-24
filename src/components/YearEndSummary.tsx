import { useState } from 'react';
import { isAfter, parseISO } from 'date-fns';
import { fmtHours, fmtDays, vakTotal, MAX_CARRY_VAK_HOURS, MAX_CARRY_RV_HOURS } from '../utils/holidays';
import type { VakBucket, AppSettings } from '../types';

interface YearEndSummaryProps {
  vakStack: VakBucket[];
  rvBalance: number;
  settings: AppSettings;
}

/**
 * Collapsible year-end projection panel showing how much VAK / RV will be
 * lost or carried over to the next year based on current bookings.
 */
export function YearEndSummary({ vakStack, rvBalance, settings }: YearEndSummaryProps) {
  const [open, setOpen] = useState(true);

  const year = settings.year;
  const yearEnd = `${year}-12-31`;

  const currentVak = vakTotal(vakStack);

  // VAK buckets that expire on or before Dec 31 and still have hours
  const vakExpiringEOY = vakStack.filter(
    (b) => b.expiresOn && !isAfter(parseISO(b.expiresOn), parseISO(yearEnd)) && b.hours > 0,
  );
  const vakLostEOY = vakExpiringEOY.reduce((s, b) => s + b.hours, 0);

  // VAK that survives (no expiry or expiry after Dec 31)
  const vakSurviving = vakStack.filter(
    (b) => !b.expiresOn || isAfter(parseISO(b.expiresOn), parseISO(yearEnd)),
  );
  const vakSurvivingHours = vakSurviving.reduce((s, b) => s + b.hours, 0);
  const vakCarryOver = Math.min(vakSurvivingHours, MAX_CARRY_VAK_HOURS);
  const vakLostAboveCap = Math.max(0, vakSurvivingHours - MAX_CARRY_VAK_HOURS);

  // RV carry-over cap
  const rvCarryOver = Math.min(rvBalance, MAX_CARRY_RV_HOURS);
  const rvLost = Math.max(0, rvBalance - MAX_CARRY_RV_HOURS);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex-shrink-0">
      {/* Header — always visible */}
      <button
        className="w-full px-5 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="text-left">
          <h3 className="font-semibold text-gray-800 text-sm">
            📋 Jaareinde samenvatting — 31 december {year}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Projectie op basis van huidige boekingen. Openstaande feestdagen (PENDING) zijn{' '}
            <em>niet</em> meegerekend.
          </p>
        </div>
        <span className="text-gray-400 text-xs ml-4 shrink-0">{open ? '▲ Inklappen' : '▼ Uitklappen'}</span>
      </button>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          {/* ── VAK column ─────────────────────────────────── */}
          <div className="p-5 space-y-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">VAK</h4>

            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">Huidig saldo</span>
              <span className="font-mono font-bold text-blue-700">
                {fmtHours(currentVak)} u{' '}
                <span className="font-normal text-blue-400 text-xs">{fmtDays(currentVak)}</span>
              </span>
            </div>

            {/* {vakExpiringEOY.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-1.5">
                <p className="text-xs font-medium text-red-700">❌ Vervalt vóór 31/12</p>
                {vakExpiringEOY.map((b) => (
                  <div key={b.id} className="flex justify-between text-xs text-red-600">
                    <span className="truncate max-w-[60%]">{b.label}</span>
                    <span className="font-mono">
                      {fmtHours(b.hours)} u{' '}
                      <span className="text-red-400">{fmtDays(b.hours)}</span> · vervalt {b.expiresOn}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between text-xs font-bold text-red-700 border-t border-red-200 pt-1.5 mt-1">
                  <span>Totaal verlies</span>
                  <span className="font-mono">
                    −{fmtHours(vakLostEOY)} u{' '}
                    <span className="font-normal text-red-400">{fmtDays(vakLostEOY)}</span>
                  </span>
                </div>
              </div>
            )} */}

            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-1.5">
              <p className="text-xs font-medium text-blue-700">✅ Overdraagbaar naar {year + 1}</p>
              <div className="flex justify-between text-xs text-blue-600">
                <span>VAK zonder vervaldatum</span>
                <span className="font-mono">
                  {fmtHours(vakSurvivingHours)} u{' '}
                  <span className="text-blue-400">{fmtDays(vakSurvivingHours)}</span>
                </span>
              </div>
              <div className="flex justify-between text-xs text-blue-600">
                <span>Plafond overdracht</span>
                <span className="font-mono">
                  {fmtHours(MAX_CARRY_VAK_HOURS)} u{' '}
                  <span className="text-blue-400">{fmtDays(MAX_CARRY_VAK_HOURS)}</span>
                </span>
              </div>
              {vakLostAboveCap > 0 && (
                <div className="flex justify-between text-xs text-amber-600 font-medium">
                  <span>Verlies boven plafond</span>
                  <span className="font-mono">
                    −{fmtHours(vakLostAboveCap)} u{' '}
                    <span className="font-normal text-amber-400">{fmtDays(vakLostAboveCap)}</span>
                  </span>
                </div>
              )}
              <div className="flex justify-between text-xs font-bold text-blue-800 border-t border-blue-200 pt-1.5 mt-1">
                <span>Effectieve overdracht VAK</span>
                <span className="font-mono">
                  {fmtHours(vakCarryOver)} u{' '}
                  <span className="font-normal text-blue-400">{fmtDays(vakCarryOver)}</span>
                </span>
              </div>
            </div>
          </div>

          {/* ── RV column ──────────────────────────────────── */}
          <div className="p-5 space-y-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              RV (Recuperatieverlof)
            </h4>

            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">Huidig saldo</span>
              <span className="font-mono font-bold text-cyan-700">
                {fmtHours(rvBalance)} u{' '}
                <span className="font-normal text-cyan-400 text-xs">{fmtDays(rvBalance)}</span>
              </span>
            </div>

            <div className="rounded-lg bg-cyan-50 border border-cyan-200 p-3 space-y-1.5">
              <p className="text-xs font-medium text-cyan-700">✅ Overdraagbaar naar {year + 1}</p>
              <div className="flex justify-between text-xs text-cyan-600">
                <span>Plafond overdracht RV</span>
                <span className="font-mono">
                  {fmtHours(MAX_CARRY_RV_HOURS)} u{' '}
                  <span className="text-cyan-400">{fmtDays(MAX_CARRY_RV_HOURS)}</span>
                </span>
              </div>
              {rvLost > 0 && (
                <div className="flex justify-between text-xs text-amber-600 font-medium">
                  <span>Verlies boven plafond</span>
                  <span className="font-mono">
                    −{fmtHours(rvLost)} u{' '}
                    <span className="font-normal text-amber-400">{fmtDays(rvLost)}</span>
                  </span>
                </div>
              )}
              <div className="flex justify-between text-xs font-bold text-cyan-800 border-t border-cyan-200 pt-1.5 mt-1">
                <span>Effectieve overdracht RV</span>
                <span className="font-mono">
                  {fmtHours(rvCarryOver)} u{' '}
                  <span className="font-normal text-cyan-400">{fmtDays(rvCarryOver)}</span>
                </span>
              </div>
            </div>

            {rvLost === 0 && (
              <p className="text-xs text-gray-400">
                RV-saldo past binnen het overdrachtsplafond van {MAX_CARRY_RV_HOURS}u.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Bottom totals bar — always visible */}
      <div className="bg-gray-50 border-t border-gray-100 px-5 py-3 flex flex-wrap gap-6">
        <div>
          <span className="text-xs text-gray-500">Totaal verlies VAK</span>
          <span className={`ml-2 text-sm font-bold ${vakLostEOY + vakLostAboveCap > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {fmtHours(vakLostEOY + vakLostAboveCap)} u{' '}
            <span className="text-xs font-normal opacity-70">{fmtDays(vakLostEOY + vakLostAboveCap)}</span>
          </span>
        </div>
        <div>
          <span className="text-xs text-gray-500">Totaal verlies RV</span>
          <span className={`ml-2 text-sm font-bold ${rvLost > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {fmtHours(rvLost)} u{' '}
            <span className="text-xs font-normal opacity-70">{fmtDays(rvLost)}</span>
          </span>
        </div>
        <div>
          <span className="text-xs text-gray-500">Meeneembaar naar {year + 1}</span>
          <span className="ml-2 text-sm font-bold text-blue-700">
            VAK {fmtHours(vakCarryOver)} u{' '}
            <span className="text-xs font-normal text-blue-400">{fmtDays(vakCarryOver)}</span>
            {' '}+ RV {fmtHours(rvCarryOver)} u{' '}
            <span className="text-xs font-normal text-blue-400">{fmtDays(rvCarryOver)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
