import { useState } from 'react';
import { parseISO, isAfter } from 'date-fns';
import { usePlanStore } from '../store/usePlanStore';
import { fmtHours, vakTotal, VAK_PER_DAY, MAX_CARRY_VAK_HOURS, MAX_CARRY_RV_HOURS } from '../utils/holidays';
import { Badge } from '../components/Badge';
import type { BucketType } from '../types';

type FilterType = 'ALL' | 'VAK' | 'RV' | 'EXPIRED';

const BUCKET_VARIANT: Record<BucketType, 'OF' | 'DF' | 'RF' | 'VF' | 'GF' | 'WV' | 'RV'> = {
  WV: 'WV', CARRY_VAK: 'WV', CARRY_RV: 'RV',
  OF: 'OF', DF: 'DF', RF: 'RF', VF: 'VF', GF: 'GF',
};

interface LedgerRow {
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

export function TableTab() {
  const { settings, vakStack, rvBalance, rvTransactions, holidayEvents, leaveEntries, expiredBuckets } = usePlanStore();
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [showVakDetail, setShowVakDetail] = useState(false);
  const [showLedger, setShowLedger] = useState(false);

  // Build a unified sorted ledger
  const rows: LedgerRow[] = [];

  // Running balances — we reconstruct from transactions in date order
  // to show running totals we need all events sorted by date
  const allEvents: Array<{ date: string; kind: string; payload: unknown }> = [];

  // RV transactions — skip those that are linked to a leave entry (they show up in the LEAVE row)
  const leaveRvTxIds = new Set(leaveEntries.map((l) => l.rvTransactionId).filter(Boolean));
  for (const tx of rvTransactions) {
    if (!leaveRvTxIds.has(tx.id)) {
      allEvents.push({ date: tx.date, kind: 'RV', payload: tx });
    }
  }

  // Holiday taken events
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

  // Year init events — synthesise from vakStack (type WV/CARRY_*)
  for (const b of [...vakStack, ...expiredBuckets]) {
    if (['WV', 'CARRY_VAK', 'CARRY_RV'].includes(b.type)) {
      allEvents.push({ date: b.addedOn, kind: 'INIT_BUCKET', payload: b });
    }
  }

  const KIND_ORDER: Record<string, number> = {
    INIT_BUCKET: 0, // carry-over VAK + base WV always first
    RV: 1,          // carry-over RV transaction (also Q1 top-up) second
    HOLIDAY: 2,
    HOLIDAY_EXP: 3,
    LEAVE: 4,
    EXPIRED_BUCKET: 5,
  };
  allEvents.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9);
  });

  // Running balances (approximated from current state + reversed events)
  // For simplicity, we track forward running balances using the sorted events
  let runVak = 0;
  let runRv = 0;

  for (const ev of allEvents) {
    const { kind, payload, date } = ev;

    if (kind === 'INIT_BUCKET') {
      const b = payload as typeof vakStack[0];
      runVak += b.totalHours;
      rows.push({
        id: b.id,
        date,
        type: b.type,
        description: b.label,
        vakDelta: b.totalHours,
        vakBalance: runVak,
        rvDelta: null,
        rvBalance: runRv,
        expiry: b.expiresOn,
        note: '',
        rowClass: 'bg-blue-50',
      });
    } else if (kind === 'RV') {
      const tx = payload as typeof rvTransactions[0];
      runRv = tx.balance;
      rows.push({
        id: tx.id,
        date,
        type: 'RV',
        description: tx.label,
        vakDelta: null,
        vakBalance: runVak,
        rvDelta: tx.deltaHours,
        rvBalance: runRv,
        expiry: null,
        note: '',
        rowClass: tx.deltaHours > 0 ? 'bg-cyan-50' : '',
      });
    } else if (kind === 'HOLIDAY') {
      const h = payload as typeof holidayEvents[0];
      const hrs = h.type === 'GF' ? 4 * 0.8 : 8 * 0.8;
      runVak += hrs;
      rows.push({
        id: h.id,
        date,
        type: h.type,
        description: `Feestdag toegekend: ${h.label}`,
        vakDelta: hrs,
        vakBalance: runVak,
        rvDelta: null,
        rvBalance: runRv,
        expiry: null,
        note: h.isRestDay ? 'Rustdag' : '',
        rowClass: 'bg-green-50',
      });
    } else if (kind === 'HOLIDAY_EXP') {
      const h = payload as typeof holidayEvents[0];
      rows.push({
        id: h.id + '-exp',
        date,
        type: h.type,
        description: `Feestdag vervallen: ${h.label}`,
        vakDelta: null,
        vakBalance: runVak,
        rvDelta: null,
        rvBalance: runRv,
        expiry: null,
        note: 'Vervallen',
        rowClass: 'bg-red-50 text-red-600',
      });
    } else if (kind === 'LEAVE') {
      const l = payload as typeof leaveEntries[0];
      const vakPart = l.bucketsConsumed.reduce((s, c) => s + c.hours, 0);
      runVak -= vakPart;
      runRv -= l.rvHoursConsumed;
      rows.push({
        id: l.id,
        date,
        type: 'LEAVE',
        description: `Verlof${l.note ? ` – ${l.note}` : ''}`,
        vakDelta: vakPart > 0 ? -vakPart : null,
        vakBalance: runVak,
        rvDelta: l.rvHoursConsumed > 0 ? -l.rvHoursConsumed : null,
        rvBalance: runRv,
        expiry: null,
        note: l.source,
        rowClass: '',
      });
    } else if (kind === 'EXPIRED_BUCKET') {
      const b = payload as typeof expiredBuckets[0];
      runVak -= b.hours;
      rows.push({
        id: b.id + '-exp',
        date,
        type: b.type,
        description: `Bucket vervallen: ${b.label}`,
        vakDelta: -b.hours,
        vakBalance: runVak,
        rvDelta: null,
        rvBalance: runRv,
        expiry: b.expiresOn,
        note: `${fmtHours(b.hours)}u verloren`,
        rowClass: 'bg-red-50 text-red-700',
      });
    }
  }

  const filtered = rows.filter((r) => {
    if (filter === 'ALL') return true;
    if (filter === 'VAK') return r.vakDelta !== null && r.vakDelta > 0;
    if (filter === 'RV') return r.type === 'RV';
    if (filter === 'EXPIRED') return r.rowClass.includes('red');
    return true;
  });

  const currentVak = vakTotal(vakStack);

  // ── Year-end summary ────────────────────────────────────────
  const year = settings.year;
  const yearEnd = `${year}-12-31`;

  // VAK buckets that still have hours and expire on/before Dec 31
  const vakExpiringEOY = vakStack.filter(
    (b) => b.expiresOn && !isAfter(parseISO(b.expiresOn), parseISO(yearEnd)) && b.hours > 0,
  );
  const vakLostEOY = vakExpiringEOY.reduce((s, b) => s + b.hours, 0);

  // VAK that survives (no expiry or expiry after Dec 31)
  const vakSurviving = vakStack.filter(
    (b) => !b.expiresOn || isAfter(parseISO(b.expiresOn), parseISO(yearEnd)),
  );
  const vakSurvivingHours = vakSurviving.reduce((s, b) => s + b.hours, 0);

  // Carry-over VAK cap: 6 days, measured in full VAK days (VAK_PER_DAY each)
  const carryVakMax = MAX_CARRY_VAK_HOURS;
  const vakCarryOver = Math.min(vakSurvivingHours, carryVakMax);
  const vakLostAboveCap = Math.max(0, vakSurvivingHours - carryVakMax);

  // RV: cap at 24h carry-over
  const rvCarryOver = Math.min(rvBalance, MAX_CARRY_RV_HOURS);
  const rvLost = Math.max(0, rvBalance - MAX_CARRY_RV_HOURS);

  return (
    <div className="p-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <p className="text-xs text-blue-500 uppercase tracking-wide font-medium">VAK huidig saldo</p>
          <p className="text-2xl font-bold text-blue-800 mt-1">{fmtHours(currentVak)} u</p>
          <p className="text-xs text-blue-500">{(currentVak / 8).toFixed(1)} werkdagen</p>
        </div>
        <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 text-center">
          <p className="text-xs text-cyan-500 uppercase tracking-wide font-medium">RV huidig saldo</p>
          <p className="text-2xl font-bold text-cyan-800 mt-1">{fmtHours(rvBalance)} u</p>
          <p className="text-xs text-cyan-500">{(rvBalance / 8).toFixed(1)} werkdagen</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Verloven geboekt</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{leaveEntries.length}</p>
          <p className="text-xs text-gray-500">{fmtHours(leaveEntries.reduce((s, l) => s + l.hours, 0))} u totaal</p>
        </div>
      </div>

      {/* VAK bucket breakdown */}
      {vakStack.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6 overflow-x-auto">
          <button
            className="w-full px-5 py-3 border-b border-gray-100 flex items-center justify-between hover:bg-gray-50 transition-colors"
            onClick={() => setShowVakDetail((v) => !v)}
          >
            <h3 className="font-semibold text-gray-700 text-sm">VAK stack detail (cascade volgorde)</h3>
            <span className="text-gray-400 text-xs">{showVakDetail ? '▲ Inklappen' : '▼ Uitklappen'}</span>
          </button>
          {showVakDetail && (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Omschrijving</th>
                <th className="px-4 py-2 text-right">Resterend</th>
                <th className="px-4 py-2 text-right">Origineel</th>
                <th className="px-4 py-2 text-left">Vervaldatum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vakStack.map((b, i) => (
                <tr key={b.id} className={i === 0 && b.expiresOn ? 'bg-amber-50' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-2">
                    <Badge variant={(BUCKET_VARIANT[b.type] ?? 'gray') as Parameters<typeof Badge>[0]['variant']} size="xs">{b.type}</Badge>
                  </td>
                  <td className="px-4 py-2 text-gray-700">{b.label}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{fmtHours(b.hours)}u</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-400">{fmtHours(b.totalHours)}u</td>
                  <td className="px-4 py-2 text-gray-500">{b.expiresOn ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      )}

      {/* Ledger */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <button
          className="w-full px-5 py-3 border-b border-gray-100 flex items-center justify-between hover:bg-gray-50 transition-colors"
          onClick={() => setShowLedger((v) => !v)}
        >
          <h3 className="font-semibold text-gray-700 text-sm">Transactieoverzicht</h3>
          <span className="text-gray-400 text-xs">{showLedger ? '▲ Inklappen' : '▼ Uitklappen'}</span>
        </button>
        {showLedger && (
          <>
            <div className="px-5 py-2 border-b border-gray-100 flex justify-end gap-1">
              {(['ALL', 'VAK', 'RV', 'EXPIRED'] as FilterType[]).map((f) => (
                <button
                  key={f}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            {filtered.length === 0 ? (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">Geen transacties{settings.initialized ? '' : ' — initialiseer eerst een jaar'}.</p>
            ) : (
              <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="px-3 py-2 text-left">Datum</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Omschrijving</th>
                <th className="px-3 py-2 text-right">VAK Δ</th>
                <th className="px-3 py-2 text-right">VAK saldo</th>
                <th className="px-3 py-2 text-right">RV Δ</th>
                <th className="px-3 py-2 text-right">RV saldo</th>
                <th className="px-3 py-2 text-left">Vervalt</th>
                <th className="px-3 py-2 text-left">Opmerking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => (
                <tr key={r.id} className={`${r.rowClass} hover:opacity-90`}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2"><Badge variant={typeToVariant(r.type)} size="xs">{r.type}</Badge></td>
                  <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate">{r.description}</td>
                  <td className={`px-3 py-2 text-right font-mono ${r.vakDelta != null && r.vakDelta > 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {r.vakDelta != null ? (r.vakDelta > 0 ? '+' : '') + fmtHours(r.vakDelta) + 'u' : '–'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-blue-700">
                    {r.vakBalance != null ? fmtHours(r.vakBalance) + 'u' : '–'}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${r.rvDelta != null && r.rvDelta > 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {r.rvDelta != null ? (r.rvDelta > 0 ? '+' : '') + fmtHours(r.rvDelta) + 'u' : '–'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-cyan-700">
                    {r.rvBalance != null ? fmtHours(r.rvBalance) + 'u' : '–'}
                  </td>
                  <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{r.expiry ?? '–'}</td>
                  <td className="px-3 py-2 text-gray-500">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
            )}
          </>
        )}
      </div>

      {/* ── Year-end summary ─────────────────────────────────── */}
      {settings.initialized && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mt-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
            <h3 className="font-semibold text-gray-800 text-sm">
              📋 Jaareinde samenvatting — 31 december {year}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Projectie op basis van huidige boekingen. Openstaande feestdagen (PENDING) zijn <em>niet</em> meegerekend.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">

            {/* VAK column */}
            <div className="p-5 space-y-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">VAK</h4>

              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Huidig saldo</span>
                <span className="font-mono font-bold text-blue-700">{fmtHours(currentVak)} u</span>
              </div>

              {vakExpiringEOY.length > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-1.5">
                  <p className="text-xs font-medium text-red-700">❌ Vervalt vóór 31/12</p>
                  {vakExpiringEOY.map((b) => (
                    <div key={b.id} className="flex justify-between text-xs text-red-600">
                      <span className="truncate max-w-[60%]">{b.label}</span>
                      <span className="font-mono">{fmtHours(b.hours)} u · vervalt {b.expiresOn}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs font-bold text-red-700 border-t border-red-200 pt-1.5 mt-1">
                    <span>Totaal verlies</span>
                    <span className="font-mono">−{fmtHours(vakLostEOY)} u</span>
                  </div>
                </div>
              )}

              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-1.5">
                <p className="text-xs font-medium text-blue-700">✅ Overdraagbaar naar {year + 1}</p>
                <div className="flex justify-between text-xs text-blue-600">
                  <span>VAK zonder vervaldatum</span>
                  <span className="font-mono">{fmtHours(vakSurvivingHours)} u</span>
                </div>
                <div className="flex justify-between text-xs text-blue-600">
                  <span>Plafond overdracht (max {MAX_CARRY_VAK_HOURS} hours)</span>
                  <span className="font-mono">{fmtHours(carryVakMax)} u</span>
                </div>
                {vakLostAboveCap > 0 && (
                  <div className="flex justify-between text-xs text-amber-600 font-medium">
                    <span>Verlies boven plafond</span>
                    <span className="font-mono">−{fmtHours(vakLostAboveCap)} u</span>
                  </div>
                )}
                <div className="flex justify-between text-xs font-bold text-blue-800 border-t border-blue-200 pt-1.5 mt-1">
                  <span>Effectieve overdracht VAK</span>
                  <span className="font-mono">{fmtHours(vakCarryOver)} u = {(vakCarryOver / VAK_PER_DAY).toFixed(1)} dagen</span>
                </div>
              </div>
            </div>

            {/* RV column */}
            <div className="p-5 space-y-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">RV (Recuperatieverlof)</h4>

              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Huidig saldo</span>
                <span className="font-mono font-bold text-cyan-700">{fmtHours(rvBalance)} u</span>
              </div>

              <div className="rounded-lg bg-cyan-50 border border-cyan-200 p-3 space-y-1.5">
                <p className="text-xs font-medium text-cyan-700">✅ Overdraagbaar naar {year + 1}</p>
                <div className="flex justify-between text-xs text-cyan-600">
                  <span>Plafond overdracht RV</span>
                  <span className="font-mono">{fmtHours(MAX_CARRY_RV_HOURS)} u</span>
                </div>
                {rvLost > 0 && (
                  <div className="flex justify-between text-xs text-amber-600 font-medium">
                    <span>Verlies boven plafond</span>
                    <span className="font-mono">−{fmtHours(rvLost)} u</span>
                  </div>
                )}
                <div className="flex justify-between text-xs font-bold text-cyan-800 border-t border-cyan-200 pt-1.5 mt-1">
                  <span>Effectieve overdracht RV</span>
                  <span className="font-mono">{fmtHours(rvCarryOver)} u</span>
                </div>
              </div>

              {rvLost === 0 && (
                <p className="text-xs text-gray-400">RV-saldo past binnen het overdrachtsplafond van {MAX_CARRY_RV_HOURS}u.</p>
              )}
            </div>
          </div>

          {/* Bottom totals bar */}
          <div className="bg-gray-50 border-t border-gray-100 px-5 py-3 flex flex-wrap gap-6">
            <div>
              <span className="text-xs text-gray-500">Totaal verlies VAK</span>
              <span className={`ml-2 text-sm font-bold ${vakLostEOY + vakLostAboveCap > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {fmtHours(vakLostEOY + vakLostAboveCap)} u
              </span>
            </div>
            <div>
              <span className="text-xs text-gray-500">Totaal verlies RV</span>
              <span className={`ml-2 text-sm font-bold ${rvLost > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {fmtHours(rvLost)} u
              </span>
            </div>
            <div>
              <span className="text-xs text-gray-500">Meeneembaar naar {year + 1}</span>
              <span className="ml-2 text-sm font-bold text-blue-700">
                VAK {fmtHours(vakCarryOver)} u + RV {fmtHours(rvCarryOver)} u
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function typeToVariant(type: string): Parameters<typeof Badge>[0]['variant'] {
  const map: Record<string, Parameters<typeof Badge>[0]['variant']> = {
    WV: 'WV', RV: 'RV', CARRY_VAK: 'WV', CARRY_RV: 'RV',
    OF: 'OF', DF: 'DF', RF: 'RF', VF: 'VF', GF: 'GF',
    LEAVE: 'gray', EXPIRED_BUCKET: 'red',
  };
  return map[type] ?? 'gray';
}
