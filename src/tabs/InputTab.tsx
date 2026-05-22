import { useState } from 'react';
import { usePlanStore } from '../store/usePlanStore';
import { DAY_NAMES, HOLIDAY_LABELS, MAX_CARRY_VAK_HOURS, MAX_CARRY_RV_HOURS, fmtHours, vakTotal, VAK_PER_DAY, fetchVariableHolidayDates } from '../utils/holidays';
import type { HolidayType, BucketType, LeaveSource } from '../types';
import { Badge } from '../components/Badge';
import { format, addWeeks, parseISO } from 'date-fns';

export function InputTab() {
  const store = usePlanStore();
  const { settings, vakStack, rvBalance, holidayEvents, leaveEntries } = store;

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
    <div className="space-y-8 p-4 max-w-5xl mx-auto">

      {/* ── Year Setup ─────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-base">Jaar-instellingen</h2>
          {settings.initialized && (
            <p className="text-xs text-gray-500 mt-0.5">
              Actief: {settings.year} · Rustdag: {DAY_NAMES[settings.restDay]} · VAK {fmtHours(vakTotal(vakStack))}u · RV {fmtHours(rvBalance)}u
            </p>
          )}
        </div>
        <div className="p-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
            <label className="label">Overdracht VAK (uren, max {MAX_CARRY_VAK_HOURS})</label>
            {/* <input type="number" className="input" min={0} max={MAX_CARRY_VAK_HOURS} step={0.5} value={carryVak} */}
            <input type="number" className="input" min={0}  step={0.1} value={carryVak}
              onChange={(e) => setCarryVak(Number(e.target.value))} />
            <p className="text-[10px] text-gray-400 mt-0.5">Vervalt 28 feb {setupYear}</p>
          </div>
          <div>
            <label className="label">Overdracht RV (uren, max {MAX_CARRY_RV_HOURS})</label>
            {/* <input type="number" className="input" min={0} max={MAX_CARRY_RV_HOURS} step={0.5} value={carryRv} */}
            <input type="number" className="input" min={0} step={0.1} value={carryRv}
              onChange={(e) => setCarryRv(Number(e.target.value))} />
            <p className="text-[10px] text-gray-400 mt-0.5">Geen vervaldatum</p>
          </div>
        </div>
        <div className="px-5 pb-4">
          <button
            className="btn-primary"
            onClick={handleInit}
            disabled={initLoading}
          >
            {initLoading
              ? '⏳ Feestdagen ophalen…'
              : settings.initialized ? '↺ Herinitialiseer jaar' : '▶ Initialiseer jaar'}
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
          {/* ── VAK & RV Summary ─────────────────────────────── */}
          {/* <section className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">VAK saldo</p>
              <p className="text-2xl font-bold text-blue-800 mt-1">{fmtHours(vakTotal(vakStack))} u</p>
              <div className="mt-2 space-y-1">
                {vakStack.map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-xs text-blue-700">
                    <span className="truncate max-w-[70%]">{b.label}</span>
                    <span className="font-mono">{fmtHours(b.hours)}u{b.expiresOn ? ` · vervalt ${b.expiresOn}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4">
              <p className="text-xs text-cyan-600 font-medium uppercase tracking-wide">RV saldo</p>
              <p className="text-2xl font-bold text-cyan-800 mt-1">{fmtHours(rvBalance)} u</p>
              <p className="text-xs text-cyan-600 mt-1">Kwartaaltoewijzingen: 4 × 19.2u = 76.8u/jaar (80%)</p>
              <p className="text-xs text-cyan-600">Tewerkstelling: 80% · Werkdag: 8u</p>
            </div>
          </section> */}

          {/* ── Feestdagen ───────────────────────────────────── */}
          {/* <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <button
              className="w-full px-5 py-4 border-b border-gray-100 flex items-center justify-between hover:bg-gray-50 transition-colors"
              onClick={() => setShowHolidays((v) => !v)}
            >
              <div className="text-left">
                <h2 className="font-semibold text-gray-800 text-base">Feestdagen</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  VAK-uren worden automatisch toegekend bij jaar-initialisatie. Boek een verlofdag via de kalender of het formulier hieronder.
                </p>
              </div>
              <span className="text-gray-400 text-xs ml-4 shrink-0">{showHolidays ? '▲ Inklappen' : '▼ Uitklappen'}</span>
            </button>

            {showHolidays && (
              <>
                <div className="p-5">
                  {holidayEvents.length === 0
                    ? <p className="text-xs text-gray-400">Geen feestdagen.</p>
                    : (
                      <div className="space-y-1">
                        {holidayEvents.map((h) => {
                          const isExpired = h.status === 'EXPIRED';
                          return (
                            <div key={h.id}
                              className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs border ${
                                isExpired
                                  ? 'border-red-200 bg-red-50 opacity-60'
                                  : h.isRestDay
                                  ? 'border-amber-200 bg-amber-50'
                                  : 'border-gray-200 bg-gray-50'
                              }`}>
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <Badge variant={isExpired ? 'gray' : h.type}>{h.type}</Badge>
                                <span className="font-medium text-gray-700">{h.date}</span>
                                <span className="text-gray-500 truncate">{h.label}</span>
                                {h.isRestDay && <Badge variant="orange" size="xs">Rustdag</Badge>}
                                {isExpired && <Badge variant="red" size="xs">Vervallen</Badge>}
                              </div>
                              <div className="flex items-center gap-2 ml-2 shrink-0">
                                <span className="font-mono text-gray-400">+{fmtHours(h.type === 'GF' ? 3.2 : 6.4)}u</span>
                                {h.vakBucketId && !isExpired && (
                                  <span className="text-green-600 text-xs">✓ Toegekend</span>
                                )}
                                <button className="btn-sm-ghost" onClick={() => store.removeHoliday(h.id)}>✕</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                </div>
                */}
                {/* Add manual VF */}
                {/*
                <div className="px-5 pb-5 border-t border-gray-100 pt-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Manuele feestdag toevoegen (bv. VF)</h3>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="label">Datum</label>
                      <input type="date" className="input" value={hDate} onChange={(e) => setHDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Type</label>
                      <select className="input" value={hType} onChange={(e) => setHType(e.target.value as HolidayType)}>
                        {(Object.keys(HOLIDAY_LABELS) as HolidayType[]).map((t) => (
                          <option key={t} value={t}>{t} – {HOLIDAY_LABELS[t]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Omschrijving</label>
                      <input type="text" className="input" placeholder={HOLIDAY_LABELS[hType]}
                        value={hLabel} onChange={(e) => setHLabel(e.target.value)} />
                    </div>
                    <button className="btn-primary" onClick={handleAddHoliday}>Toevoegen</button>
                  </div>
                </div>
              </>
            )}
          </section> */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800 text-base">Manuele Verlofinvoer</h2>
              <p className="text-xs text-gray-500 mt-0.5">1 werkdag = 8u · Verdient {fmtHours(VAK_PER_DAY)}u VAK per feestdag (8u × 80%)</p>
            </div>
            <div className="p-5 flex flex-wrap gap-3 items-end">
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
              <div className="flex-1 min-w-[150px]">
                <label className="label">Opmerking</label>
                <input type="text" className="input" value={lNote} onChange={(e) => setLNote(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={handleAddLeave}>Boeken</button>
            </div>
            {lError && <p className="px-5 pb-3 text-sm text-red-600">⚠ {lError}</p>}
          </section>

          {/* ── Manuele Feestdaginvoer ───────────────────────── */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800 text-base">Manuele Feestdaginvoer</h2>
              <p className="text-xs text-gray-500 mt-0.5">Voeg manueel een VAK-bucket toe voor een feestdag of speciale toekenning.</p>
            </div>
            <div className="p-5 flex flex-wrap gap-3 items-end">
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
              <div className="flex-1 min-w-[150px]">
                <label className="label">Omschrijving</label>
                <input type="text" className="input" value={mLabel} placeholder={`${mType} (${mDate || 'datum'})`} onChange={(e) => setMLabel(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={handleAddVakBucket}>Toevoegen</button>
            </div>
            {mError && <p className="px-5 pb-3 text-sm text-red-600">⚠ {mError}</p>}
          </section>

          {/* ── Booked Leave List ─────────────────────────────── */}
          {/* {leaveEntries.length > 0 && (
            <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-800 text-base">Geboekte verloven</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left">Datum</th>
                      <th className="px-4 py-2 text-right">Uren</th>
                      <th className="px-4 py-2 text-left">Bron</th>
                      <th className="px-4 py-2 text-left">Opmerking</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...leaveEntries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-700">{e.date}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmtHours(e.hours)}u</td>
                        <td className="px-4 py-2">
                          <Badge variant={e.source === 'RV' ? 'RV' : 'WV'}>{e.source}</Badge>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{e.note}</td>
                        <td className="px-4 py-2 text-right">
                          <button className="btn-sm-danger" onClick={() => store.removeLeave(e.id)}>Verwijder</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )} */}

          {/* ── Expire Buckets ────────────────────────────────── */}
          {/* <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="font-semibold text-gray-800 text-base mb-3">Onderhoud</h2>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="label">Controleer vervaldatums per</label>
                <input type="date" id="expire-date" className="input"
                  defaultValue={format(new Date(), 'yyyy-MM-dd')} />
              </div>
              <button className="btn-secondary" onClick={() => {
                const d = (document.getElementById('expire-date') as HTMLInputElement).value;
                if (d) store.expireBuckets(d);
              }}>
                Vervallen buckets verwijderen
              </button>
              <button className="btn-danger" onClick={() => {
                if (confirm('Weet je zeker dat je alles wilt wissen?')) store.resetAll();
              }}>Reset alles</button>
            </div>
          </section> */}

          {/* ── Export / Import ───────────────────────────────── */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="font-semibold text-gray-800 text-base mb-3">Export / Import</h2>
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
