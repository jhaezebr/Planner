import { useState } from 'react';
import { InputTab } from './tabs/InputTab';
import { CalendarTab } from './tabs/CalendarTab';
import { TableTab } from './tabs/TableTab';
import { usePlanStore } from './store/usePlanStore';
import { WORK_PCT, HOURS_PER_DAY, VAK_PER_DAY, QUARTERLY_RV, MAX_CARRY_VAK_HOURS, MAX_CARRY_RV_HOURS, fmtHours } from './utils/holidays';

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings } = usePlanStore();

  return (
    <div className="h-screen bg-gray-50 font-sans flex flex-col overflow-hidden">
      {settingsOpen ? (
        /* ── Settings / Invoer overlay ───────────────────────── */
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="bg-white border-b border-gray-200 shadow-sm px-4 py-2.5 flex items-center justify-between flex-shrink-0">
            <h2 className="text-sm font-semibold text-gray-800">⚙️ Instellingen &amp; Invoer</h2>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              onClick={() => setSettingsOpen(false)}
            >
              ← Terug naar overzicht
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <InputTab />
          </div>
        </div>
      ) : (
        /* ── Main overview ───────────────────────────────────── */
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Slim top bar */}
          <div className="bg-white border-b border-gray-200 shadow-sm px-4 py-2 flex items-center justify-between flex-shrink-0">
            {/* Config summary pill */}
            {settings.initialized ? (
              <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                <span className="font-semibold text-gray-700">{settings.year}</span>
                <span className="text-gray-300">|</span>
                <span>Tewerkstelling <strong className="text-gray-700">{WORK_PCT * 100}%</strong></span>
                <span className="text-gray-300">|</span>
                <span>Werkdag <strong className="text-gray-700">{HOURS_PER_DAY}u</strong></span>
                <span className="text-gray-300">|</span>
                <span>VAK/feestdag <strong className="text-gray-700">{fmtHours(VAK_PER_DAY)}u</strong></span>
                <span className="text-gray-300">|</span>
                <span>RV/kwartaal <strong className="text-gray-700">{fmtHours(QUARTERLY_RV)}u</strong></span>
                <span className="text-gray-300">|</span>
                <span>Max overdracht VAK <strong className="text-gray-700">{fmtHours(MAX_CARRY_VAK_HOURS)}u</strong></span>
                <span className="text-gray-300">|</span>
                <span>Max overdracht RV <strong className="text-gray-700">{fmtHours(MAX_CARRY_RV_HOURS)}u</strong></span>
              </div>
            ) : (
              <span className="text-xs text-amber-600 font-medium">⚠ Nog niet geïnitialiseerd — open instellingen om te starten.</span>
            )}
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0 ml-4"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙️ Instellingen
            </button>
          </div>

          {/* Calendar + Table side-by-side */}
          <div className="flex gap-4 px-4 pt-4 flex-1 min-h-0 overflow-hidden max-w-[1800px] w-full mx-auto">
            <div className="w-2/5 flex-shrink-0 overflow-y-auto">
              <CalendarTab />
            </div>
            <div className="w-3/5 min-w-0">
              <TableTab />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
