// src/lib/expiry.ts
import { Timestamp } from 'firebase/firestore';

/** Returns a Firestore Timestamp 400 days after the given YYYY-MM-DD (UTC midnight). */
export function expiryFor(dateISO: string, days = 400) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return Timestamp.fromDate(dt);
}
