import { useRef } from 'react';

interface Props {
  hours: number;
  minutes: number;
  onHours: (h: number) => void;
  onMinutes: (m: number) => void;
  maxHours?: number;
  className?: string;
}

/**
 * A single-looking "HH:MM" input composed of two number fields separated by a colon.
 * Automatically moves focus to the minutes field after 2 hour digits are entered.
 */
export function TimeInput({ hours, minutes, onHours, onMinutes, className = '' }: Props) {
  const minRef = useRef<HTMLInputElement>(null);

  const handleHoursChange = (raw: string) => {
    // Strip non-digits
    const digits = raw.replace(/\D/g, '').slice(0, 3);
    const val = Number(digits);
    onHours(val);
    if (digits.length >= 2) minRef.current?.focus();
  };

  const handleMinutesChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 3);
    const val = Math.min(Number(digits), 59);
    onMinutes(val);
  };

  const hStr = String(hours).padStart(2, '0');
  const mStr = String(minutes).padStart(2, '0');

  return (
    <div className={`inline-flex items-center gap-0 border border-gray-300 rounded-md bg-white px-2 py-1 focus-within:ring-2 focus-within:ring-blue-400 focus-within:border-blue-400 transition ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        className="w-8 text-center bg-transparent outline-none text-sm font-mono leading-none"
        value={hStr}
        onChange={(e) => handleHoursChange(e.target.value)}
        onFocus={(e) => e.target.select()}
      />
      <span className="text-gray-400 font-mono select-none leading-none">:</span>
      <input
        ref={minRef}
        type="text"
        inputMode="numeric"
        className="w-8 text-center bg-transparent outline-none text-sm font-mono leading-none"
        value={mStr}
        onChange={(e) => handleMinutesChange(e.target.value)}
        onFocus={(e) => e.target.select()}
      />
    </div>
  );
}
