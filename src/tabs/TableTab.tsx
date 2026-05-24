import { useState } from 'react';
import { usePlanStore } from '../store/usePlanStore';
import { fmtHours } from '../utils/holidays';
import { buildLedger } from '../utils/buildLedger';
import type { LedgerRow } from '../utils/buildLedger';
import { YearEndSummary } from '../components/YearEndSummary';
import { Badge } from '../components/Badge';

type FilterType = 'ALL' | 'VAK' | 'RV' | 'EXPIRED';

export function TableTab() {
  const { settings, vakStack, rvBalance, rvTransactions, holidayEvents, leaveEntries, expiredBuckets } = usePlanStore();
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [showLedger, setShowLedger] = useState(false);

  const rows: LedgerRow[] = buildLedger(vakStack, rvTransactions, holidayEvents, leaveEntries, expiredBuckets, settings);

  const filtered = rows.filter((r) => {
    if (filter === 'ALL') return true;
    if (filter === 'VAK') return r.vakDelta !== null && r.vakDelta > 0;
    if (filter === 'RV') return r.type === 'RV';
    if (filter === 'EXPIRED') return r.rowClass.includes('red');
    return true;
  });

  return (
    <div className="p-4 flex flex-col gap-4" style={{ height: 'calc(100vh - 4rem)' }}>

      {/* Ledger */}
      <div className={`bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col flex-shrink-0 ${showLedger ? 'flex-1 min-h-0' : ''}`}>
        <button
          className="w-full px-5 py-3 border-b border-gray-100 flex items-center justify-between hover:bg-gray-50 transition-colors"
          onClick={() => setShowLedger((v) => !v)}
        >
          <h3 className="font-semibold text-gray-700 text-sm">Transactieoverzicht</h3>
          <span className="text-gray-400 text-xs">{showLedger ? '▲ Inklappen' : '▼ Uitklappen'}</span>
        </button>
        {showLedger && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-5 py-2 border-b border-gray-100 flex justify-end gap-1 flex-shrink-0">
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
              <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
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
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Year-end summary ─────────────────────────────────── */}
      {settings.initialized && (
        <YearEndSummary vakStack={vakStack} rvBalance={rvBalance} settings={settings} />
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
