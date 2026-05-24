import type { VakBucket, BucketConsumption } from '../types';
import { sortVakStack } from '../utils/holidays';

/**
 * Holiday bucket types — each represents exactly one public holiday day and
 * must be consumed whole (no partial depletion in the cascade).
 */
const HOLIDAY_BUCKET_TYPES: ReadonlySet<string> = new Set(['OF', 'DF', 'RF', 'VF', 'GF']);

/**
 * Consume `hours` from the VAK stack using nearest-expiry-first ordering.
 *
 * Rules:
 * - Only buckets with `addedOn <= asOf` are eligible.
 * - Holiday-type buckets (OF/DF/RF/VF/GF) must be consumed in full or not at
 *   all — except for the `priorityBucketId` bucket (the holiday for the leave
 *   date itself) which may be partially consumed.
 * - If a `priorityBucketId` is provided, that bucket is moved to the front of
 *   the cascade so it is consumed first.
 *
 * Returns the updated stack and a consumption log (used for removeLeave).
 */
export function consumeVak(
  stack: VakBucket[],
  hours: number,
  asOf: string,
  priorityBucketId?: string | null,
): { newStack: VakBucket[]; consumed: BucketConsumption[] } {
  const sorted = sortVakStack(stack);

  // Move the priority bucket (holiday for this exact leave date) to the front
  if (priorityBucketId) {
    const idx = sorted.findIndex((b) => b.id === priorityBucketId);
    if (idx > 0) sorted.unshift(...sorted.splice(idx, 1));
  }

  const newStack = sorted.map((b) => ({ ...b }));
  const consumed: BucketConsumption[] = [];
  let remaining = hours;

  for (const b of newStack) {
    if (remaining <= 0) break;
    if (b.hours <= 0) continue;
    // Only consume buckets that have been earned by the leave date
    if (b.addedOn > asOf) continue;
    // Holiday-type buckets must be consumed whole; skip if only a partial
    // amount would be taken (WV absorbs the remainder instead).
    // Exception: the priority bucket for this date may be consumed partially.
    if (HOLIDAY_BUCKET_TYPES.has(b.type) && b.hours > remaining && b.id !== priorityBucketId) continue;

    const take = Math.min(b.hours, remaining);
    consumed.push({ bucketId: b.id, bucketLabel: b.label, hours: take });
    b.hours -= take;
    remaining -= take;
  }

  return { newStack, consumed };
}
