import { useState } from 'react';
import { InputTab } from './tabs/InputTab';
import { CalendarTab } from './tabs/CalendarTab';
import { TableTab } from './tabs/TableTab';

type Tab = 'input' | 'calendar' | 'table';

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'input', label: 'Invoer', icon: '✏️' },
  { id: 'calendar', label: 'Kalender', icon: '📅' },
  { id: 'table', label: 'Overzicht', icon: '📊' },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('input');

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">PlanPredict</h1>
            <p className="text-xs text-gray-500">Werkplanning emulator · UZ Gent · 80%</p>
          </div>
          <nav className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === t.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="py-6">
        {activeTab === 'input' && <InputTab />}
        {activeTab === 'calendar' && <CalendarTab />}
        {activeTab === 'table' && <TableTab />}
      </main>
    </div>
  );
}

export default App;
