export type HolidayType = 'OF' | 'DF' | 'RF' | 'VF' | 'GF';
export type BucketType = 'WV' | 'VF' | 'OF' | 'DF' | 'RF' | 'GF' | 'CARRY_VAK' | 'CARRY_RV';
export type LeaveSource = 'AUTO' | 'VAK' | 'RV';
export type HolidayStatus = 'PENDING' | 'TAKEN' | 'EXPIRED';

/** A single bucket of VAK hours (part of the cascade stack) */
export interface VakBucket {
  id: string;
  label: string;
  type: BucketType;
  hours: number;         // remaining hours in this bucket
  totalHours: number;    // original hours when bucket was created
  addedOn: string;       // ISO date string
  expiresOn: string | null; // ISO date string, null = no expiry
}

/** A known public / legal holiday for the year */
export interface HolidayEvent {
  id: string;
  date: string;        // ISO date string (YYYY-MM-DD)
  type: HolidayType;
  label: string;
  status: HolidayStatus;
  isRestDay: boolean;  // holiday falls on the configured rest day
  vakBucketId: string | null; // set when status becomes TAKEN
}

/** Record of hours consumed from a specific bucket during a leave entry */
export interface BucketConsumption {
  bucketId: string;
  bucketLabel: string;
  hours: number;
}

/** A leave entry (a day or partial day of leave taken) */
export interface LeaveEntry {
  id: string;
  date: string;        // ISO date string
  hours: number;
  source: LeaveSource;
  bucketsConsumed: BucketConsumption[]; // for VAK / AUTO
  rvHoursConsumed: number;              // for RV portion
  note: string;
}

/** A single RV transaction (top-up or deduction) */
export interface RvTransaction {
  id: string;
  date: string;
  deltaHours: number;  // positive = added, negative = consumed
  label: string;
  balance: number;     // running balance after this transaction
}

/** Global app settings */
export interface AppSettings {
  year: number;
  workPct: number;    // always 0.8 for now
  restDay: number;    // 0=Sunday,1=Monday,...,6=Saturday
  initialized: boolean;
}

/** Full application state (persisted) */
export interface AppState {
  settings: AppSettings;
  vakStack: VakBucket[];       // ordered: index 0 = consumed first (nearest expiry)
  rvBalance: number;           // current RV balance in hours
  rvTransactions: RvTransaction[];
  holidayEvents: HolidayEvent[];
  leaveEntries: LeaveEntry[];
  expiredBuckets: VakBucket[]; // buckets that expired with remaining hours
}
