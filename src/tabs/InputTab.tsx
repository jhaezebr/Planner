import { useState } from 'react';
import { usePlanStore } from '../store/usePlanStore';
import { DAY_NAMES, HOLIDAY_LABELS, MAX_CARRY_VAK_HOURS, MAX_CARRY_RV_HOURS, fmtHours, vakTotal, VAK_PER_DAY, fetchVariableHolidayDates } from '../utils/holidays';
import type { HolidayType, BucketType, LeaveSource } from '../types';
import { format, addWeeks, parseISO } from 'date-fns';

export function InputTab() {
  const store = usePlanStore();
  const { settings, vakStack, rvBalance } = store;

  // Year setup form
  const [setupYear, setSetupYear] = useState(settings.year || new Date().getFullYear());
  const [setupRestDay, setSetupRestDay] = useState(settings.restDay ?? 3);
  const [carryVak, setCarryVak] = useState(0);
  const [carryRv, setCarryRv] = useState(0);

  // Leave form
  const [lDate, setLDate] = useState('');
  const [lHours, setLHours] = useState(8);
  const [lMinutes, setLMinutes] = useState(0);
  const [lSource, setLSource] = useState<LeaveSource>('AUTO');
  const [lNote, setLNote] = useState('');  const [lError, setLError] = useState<string | null>(null);
  // Manual VAK bucket form
  const [mDate, setMDate] = useState('');
  const [mExpiry, setMExpiry] = useState('');
  const [mHours, setMHours] = useState(Math.floor(VAK_PER_DAY));
  const [mMinutes, setMMinutes] = useState(Math.round((VAK_PER_DAY % 1) * 60));
  const [mType, setMType] = useState<BucketType>('VF');
  const [mLabel, setMLabel] = useState('');
  const [mError, setMError] = useState<string | null>(null);

  const handleMDateChange = (val: string) => {
    setMDate(val);
    setMExpiry(val ? format(addWeeks(parseISO(val), 6), 'yyyy-MM-dd') : '');
  };

  const handleAddVakBucket = () => {
    setMError(null);
    if (!mDate) { setMError('Selecteer een datum'); return; }
    const h = mHours + mMinutes / 60;
    if (h <= 0) { setMError('Ongeldige uren'); return; }
    store.addManualVakBucket(mDate, mType, mLabel || `${mType} (${mDate})`, h, mExpiry || null);
    setMDate('');
    setMExpiry('');
    setMHours(Math.floor(VAK_PER_DAY));
    setMMinutes(Math.round((VAK_PER_DAY % 1) * 60));
    setMLabel('');
  };

  const [initLoading, setInitLoading] = useState(false);

  const handleInit = async () => {
    setInitLoading(true);
    try {
      const variableDates = await fetchVariableHolidayDates(setupYear);
      store.initYear(setupYear, setupRestDay, carryVak, carryRv, variableDates);
    } finally {
      setInitLoading(false);
    }
  };

  const handleAddLeave = () => {
    setLError(null);
    if (!lDate) { setLError('Selecteer een datum'); return; }
    const hours = lHours + lMinutes / 60;
    const err = store.addLeave(lDate, hours, lSource, lNote);
    if (err) { setLError(err); return; }
    setLDate('');
    setLHours(8);
    setLMinutes(0);
    setLNote('');
  };

  return (
    <div className="space-y-3 p-4 max-w-5xl mx-auto">

      {/* ── Year Setup ─────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-base">Jaar-instellingen</h2>
          {settings.initialized && (
            <p className="text-xs text-gray-500 mt-0.5">
              Actief: {settings.year} · Rustdag: {DAY_NAMES[settings.restDay]} · VAK {fmtHours(vakTotal(vakStack))}u · RV {fmtHours(rvBalance)}u
            </p>
          )}
        </div>
        <div className="px-4 py-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Jaar</label>
            <input type="number" className="input" value={setupYear}
              onChange={(e) => setSetupYear(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Rustdag</label>
            <select className="input" value={setupRestDay}
              onChange={(e) => setSetupRestDay(Number(e.target.value))}>
              {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Overdracht VAK (u, max {MAX_CARRY_VAK_HOURS})</label>
            <input type="number" className="input" min={0} step={0.1} value={carryVak}
              onChange={(e) => setCarryVak(Number(e.target.value))} />
            <p className="text-[10px] text-gray-400 mt-0.5">Vervalt 28 feb {setupYear}</p>
          </div>
          <div>
            <label className="label">Overdracht RV (u, max {MAX_CARRY_RV_HOURS})</label>
            <input type="number" className="input" min={0} step={0.1} value={carryRv}
              onChange={(e) => setCarryRv(Number(e.target.value))} />
            <p className="text-[10px] text-gray-400 mt-0.5">Geen vervaldatum</p>
          </div>
        </div>
        <div className="px-4 pb-3">
          <button className="btn-primary" onClick={handleInit} disabled={initLoading}>
            {initLoading ? '⏳ Feestdagen ophalen…' : settings.initialized ? '↺ Herinitialiseer jaar' : '▶ Initialiseer jaar'}
          </button>
          {settings.initialized && (
            <span className="ml-3 text-xs text-amber-600">⚠ Herinitialiseren wist alle verlofboekingen!</span>
          )}
        </div>
      </section>

      {!settings.initialized ? (
        <p className="text-center text-gray-400 py-8">Initialiseer eerst een jaar om verder te gaan.</p>
      ) : (
        <>
          {/* ── Verlof + Feestdag side-by-side ───────────────── */}
          <div className="grid grid-cols-2 gap-3">
            {/* Manuele Verlofinvoer */}
            <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-gray-800 text-base">Manuele Verlofinvoer</h2>
                <p className="text-xs text-gray-500 mt-0.5">1 werkdag = 8u · VAK/feestdag: {fmtHours(VAK_PER_DAY)}u</p>
              </div>
              <div className="p-3 flex flex-wrap gap-2 items-end">
                <div>
                  <label className="label">Datum</label>
                  <input type="date" className="input" value={lDate} onChange={(e) => setLDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Uren</label>
                  <input type="number" className="input w-20" min={0} max={8} value={lHours}
                    onChange={(e) => setLHours(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Minuten</label>
                  <input type="number" className="input w-20" min={0} max={59} value={lMinutes}
                    onChange={(e) => setLMinutes(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Bron</label>
                  <select className="input" value={lSource} onChange={(e) => setLSource(e.target.value as LeaveSource)}>
                    <option value="AUTO">Auto (cascade)</option>
                    <option value="VAK">Enkel VAK</option>
                    <option value="RV">Enkel RV</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className="label">Opmerking</label>
                  <input type="text" className="input" value={lNote} onChange={(e) => setLNote(e.target.value)} />
                </div>
                <div className="w-full">
                  <button className="btn-primary w-full" onClick={handleAddLeave}>Boeken</button>
                </div>
              </div>
              {lError && <p className="px-3 pb-2 text-sm text-red-600">⚠ {lError}</p>}
            </section>

            {/* Manuele Feestdaginvoer */}
            <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-gray-800 text-base">Manuele Feestdaginvoer</h2>
                <p className="text-xs text-gray-500 mt-0.5">Voeg manueel een VAK-bucket toe.</p>
              </div>
              <div className="p-3 flex flex-wrap gap-2 items-end">
                <div>
                  <label className="label">Datum</label>
                  <input type="date" className="input" value={mDate} onChange={(e) => handleMDateChange(e.target.value)} />
                </div>
                <div>
                  <label className="label">Vervaldatum</label>
                  <input type="date" className="input" value={mExpiry} onChange={(e) => setMExpiry(e.target.value)} />
                </div>
                <div>
                  <label className="label">Uren</label>
                  <input type="number" className="input w-20" min={0} max={24} value={mHours}
                    onChange={(e) => setMHours(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Minuten</label>
                  <input type="number" className="input w-20" min={0} max={59} value={mMinutes}
                    onChange={(e) => setMMinutes(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Type VAK</label>
                  <select className="input" value={mType} onChange={(e) => setMType(e.target.value as BucketType)}>
                    {(['VF', 'OF', 'DF', 'RF', 'GF', 'WV'] as BucketType[]).map((t) => (
                      <option key={t} value={t}>{t}{HOLIDAY_LABELS[t as HolidayType] ? ` – ${HOLIDAY_LABELS[t as HolidayType]}` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className="label">Opmerking</label>
                  <input type="text" className="input" value={mLabel} placeholder={`${mType} (${mDate || 'datum'})`} onChange={(e) => setMLabel(e.target.value)} />
                </div>
                <div className="w-full">
                  <button className="btn-primary w-full" onClick={handleAddVakBucket}>Boeken</button>
                </div>
              </div>
              {mError && <p className="px-3 pb-2 text-sm text-red-600">⚠ {mError}</p>}
            </section>
          </div>

          {/* ── Export / Import ───────────────────────────────── */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
            <h2 className="font-semibold text-gray-800 text-sm mb-2">Export / Import</h2>
            <div className="flex gap-3">
              <button className="btn-secondary" onClick={() => {
                const blob = new Blob([store.exportData()], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `planpredict-${settings.year}.json`;
                a.click();
              }}>⬇ Exporteer JSON</button>
              <label className="btn-secondary cursor-pointer">
                ⬆ Importeer JSON
                <input type="file" accept=".json" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  f.text().then((t) => store.importData(t));
                }} />
              </label>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

