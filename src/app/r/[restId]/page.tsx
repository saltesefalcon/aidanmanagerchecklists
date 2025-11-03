'use client';

import Link from 'next/link';
import SessionGate from '@/components/SessionGate';
import SignOutButton from '@/components/SignOutButton';
import { useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getBusinessDate } from '@/lib/bizdate';
import { expiryFor } from '@/lib/expiry';

type Shift = 'open' | 'mid' | 'close';

export default function RestaurantSelectPage() {
  const router = useRouter();
  const params = useParams<{ restId: string }>();
  const restId = params?.restId; // Next 16: read from useParams()

  const defaultDate = useMemo(() => getBusinessDate(), []);
  const [date, setDate] = useState(defaultDate);

  const go = (shift: Shift) => {
    if (!date || !restId) return;
    router.push(`/r/${restId}/${date}/${shift}`);
  };

  const title = restId
    ? restId.charAt(0).toUpperCase() + restId.slice(1)
    : '...';

  return (
    <SessionGate>
      <main className="p-6 max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex items-center px-3 py-2 rounded border hover:bg-slate-50">
              ← Home
            </Link>
            <h1 className="text-2xl font-semibold">{title} — Select Date & Shift</h1>
          </div>
          <SignOutButton />
        </header>

        <section className="space-y-3">
          <label className="block">
            <span className="text-sm">Business Date (5am cutoff)</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 border rounded px-3 py-2"
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <button onClick={() => go('open')}  className="h-16 rounded-xl border text-lg font-medium">Open</button>
            <button onClick={() => go('mid')}   className="h-16 rounded-xl border text-lg font-medium">Mid</button>
            <button onClick={() => go('close')} className="h-16 rounded-xl border text-lg font-medium">Close</button>
          </div>
        </section>
      </main>
    </SessionGate>
  );
}
