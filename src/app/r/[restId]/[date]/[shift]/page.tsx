'use client';

import React, { useEffect, useMemo, useState, use } from 'react';
import SessionGate from '@/components/SessionGate';
import SignOutButton from '@/components/SignOutButton';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

type Shift = 'open' | 'mid' | 'close';

type Item = {
  id: string;
  title: string;
  checked?: boolean;
  checkedByUID?: string | null;
  checkedByName?: string | null;
  checkedAt?: Timestamp | null;
  notes?: string;
  priority?: boolean;
  order?: number;
};

export default function ShiftChecklistPage({
  params,
}: {
  params: Promise<{ restId: string; date: string; shift: Shift }>;
}) {
  // ✅ Next 16: unwrap route params in a Client Component
  const { restId, date: dateISO, shift } = use(params);

  const [items, setItems] = useState<Item[]>([]);
  const [locked, setLocked] = useState(false);

  // Firestore refs
  const shiftRef = doc(db, 'restaurants', restId, 'checklists', dateISO, 'shifts', shift);
  const itemsCol = collection(shiftRef, 'items');

  // Live subscribe to shift lock state + items (ordered)
  useEffect(() => {
    const unsub1 = onSnapshot(shiftRef, (s) => {
      setLocked(!!s.data()?.locked);
    });

    const qItems = query(itemsCol, orderBy('order'));
    const unsub2 = onSnapshot(qItems, (snap) => {
      const rows: Item[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setItems(rows);
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [restId, dateISO, shift]);

  const title = useMemo(
    () =>
      `${restId.charAt(0).toUpperCase()}${restId.slice(1)} — ${dateISO} — ${shift.toUpperCase()}`,
    [restId, dateISO, shift]
  );

  const toggle = async (it: Item) => {
    if (locked) return;

    const me = auth.currentUser;
    const now = serverTimestamp();

    await updateDoc(doc(itemsCol, it.id), {
      checked: !it.checked,
      checkedByUID: it.checked ? null : (me?.uid ?? null),
      checkedByName: it.checked ? null : (me?.displayName || me?.email || null),
      checkedAt: it.checked ? null : now,
    });
  };

  const percent = useMemo(() => {
    if (!items.length) return 0;
    const done = items.filter((i) => i.checked).length;
    return Math.round((done / items.length) * 100);
  }, [items]);

  const statusColor =
    percent >= 90 ? 'text-green-600' : percent >= 80 ? 'text-yellow-600' : 'text-red-600';

  const submitAndLock = async () => {
    if (locked) return;

    const me = auth.currentUser;
    // TTL: 400 days from now
    const expireMs = 400 * 24 * 60 * 60 * 1000;
    const expireAt = Timestamp.fromMillis(Date.now() + expireMs);

    await setDoc(
      shiftRef,
      {
        locked: true,
        completedAt: serverTimestamp(),
        completedByUID: me?.uid ?? null,
        completedByName: me?.displayName || me?.email || null,
        expireAt, // TTL field (we created TTL policies on this)
      },
      { merge: true }
    );
  };

  return (
    <SessionGate>
      <main className="p-6 max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a
              href={`/r/${restId}`}
              className="inline-flex items-center px-3 py-2 rounded border hover:bg-slate-50"
            >
              ← Home
            </a>
            <h1 className="text-2xl font-semibold">{title}</h1>
          </div>
          <SignOutButton />
        </header>

        <div className="flex items-center justify-between">
          <a
            href={`/r/${restId}`}
            className="text-sm underline hover:no-underline"
          >
            Back to date/shift
          </a>
          <div className={`text-sm font-semibold ${statusColor}`}>Completed: {percent}%</div>
        </div>

        <section className="rounded-xl border p-4 space-y-3">
          {items.map((it) => (
            <label
              key={it.id}
              className={`flex items-start gap-3 rounded border p-4 ${
                it.priority ? 'border-red-400' : ''
              }`}
            >
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={!!it.checked}
                disabled={locked}
                onChange={() => toggle(it)}
              />
              <div className="flex-1">
                <div className={`font-medium ${it.priority ? 'text-red-600' : ''}`}>{it.title}</div>
                {it.checked && (
                  <div className="text-xs text-slate-600">
                    Signed by {it.checkedByName ?? 'Unknown'}{/* time is serverTimestamp */}
                  </div>
                )}
              </div>
            </label>
          ))}

          <div className="pt-4 flex items-center justify-between">
            <div className="text-sm text-slate-600">
              {locked ? 'This checklist is locked.' : 'You can still make changes.'}
            </div>
            <button
              disabled={locked}
              onClick={submitAndLock}
              className={`px-4 py-2 rounded ${
                locked ? 'bg-slate-300 text-slate-600' : 'bg-slate-800 text-white'
              }`}
              title="Finalize this shift's checklist and lock it"
            >
              Submit & Lock
            </button>
          </div>
        </section>
      </main>
    </SessionGate>
  );
}
