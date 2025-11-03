'use client';

import Link from 'next/link';
import SessionGate from '@/components/SessionGate';
import SignOutButton from '@/components/SignOutButton';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { expiryFor } from '@/lib/expiry';

type Shift = 'open' | 'mid' | 'close';
type Item = {
  id: string;
  title: string;
  priority?: boolean;
  order?: number;
  checked?: boolean;
  checkedByUID?: string;
  checkedByName?: string;
  checkedAt?: any;
  notes?: string;
};

type Me = { uid: string; name: string; isAdmin: boolean };

export default function ShiftChecklistPage() {
  const params = useParams<{ restId: string; date: string; shift: Shift }>();
  const restId = params.restId;
  const date = params.date;
  const shift = params.shift;

  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [seeding, setSeeding] = useState(true);
  const [locked, setLocked] = useState(false);
  const [completed, setCompleted] = useState<{ by?: string; at?: any } | null>(null);

  const title =
    `${restId.charAt(0).toUpperCase() + restId.slice(1)} — ${date} — ${shift.toUpperCase()}`;

  // who am I (+ role)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      const us = await getDoc(doc(db, 'users', u.uid));
      const d = us.data() as any;
      const name = (d?.displayName as string) || u.email || 'Manager';
      const isAdmin = (d?.role as string) === 'admin';
      setMe({ uid: u.uid, name, isAdmin });
    });
    return () => unsub();
  }, []);

  // refs
  const shiftRef = useMemo(
    () => doc(db, 'restaurants', restId, 'checklists', date, 'shifts', shift),
    [restId, date, shift]
  );
  const itemsCol = useMemo(
    () => collection(db, 'restaurants', restId, 'checklists', date, 'shifts', shift, 'items'),
    [restId, date, shift]
  );

  // watch lock/completion
  useEffect(() => {
    const unsub = onSnapshot(shiftRef, (snap) => {
      const d = snap.data() as any;
      setLocked(!!d?.locked);
      if (d?.completedByName || d?.completedAt) {
        setCompleted({ by: d.completedByName, at: d.completedAt });
      } else setCompleted(null);
    });
    return () => unsub();
  }, [shiftRef]);

  // seed once if empty
  useEffect(() => {
    let alive = true;
    (async () => {
      setSeeding(true);

      // ensure shift doc
      const s = await getDoc(shiftRef);
      if (!s.exists()) {
        await setDoc(shiftRef, { locked: false, createdAt: serverTimestamp() }, { merge: true });
      }

      // only seed if no items yet
      const existing = await getDocs(itemsCol);
      if (existing.empty) {
        await reseedFromTemplate();
      }

      if (alive) setSeeding(false);
    })();
    return () => {
      alive = false;
    };
  }, [restId, date, shift, itemsCol, shiftRef]);

  // live items
  useEffect(() => {
    const q = query(itemsCol, orderBy('order', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const list: Item[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setItems(list);
    });
    return () => unsub();
  }, [itemsCol]);

  // reseed helper (admin-only by UI; rules enforce admin for deletes)
const reseedFromTemplate = async () => {
  // Optional: only admins stamp the day doc; managers may not have write to /checklists/{date}
  if (me?.isAdmin) {
    const dayRef = doc(db, 'restaurants', restId, 'checklists', date);
    await setDoc(dayRef, { date, expireAt: expiryFor(date) }, { merge: true });
  }

  // Clear existing items
  const existing = await getDocs(itemsCol);
  if (!existing.empty) {
    const bDel = writeBatch(db);
    existing.forEach((d) => bDel.delete(d.ref));
    await bDel.commit();
  }

  // Ensure shift (unlocked) with expireAt
  await setDoc(shiftRef, { locked: false, createdAt: serverTimestamp(), expireAt: expiryFor(date) }, { merge: true });

  // Read current template and seed with expireAt
  const cfgRef = doc(db, 'restaurants', restId, 'settings', 'config');
  const cfgSnap = await getDoc(cfgRef);
  const dutyTemplates = (cfgSnap.data()?.dutyTemplates || {}) as Record<Shift, any[]>;
  const duties = Array.isArray(dutyTemplates[shift]) ? dutyTemplates[shift] : [];

  const b2 = writeBatch(db);
  duties.forEach((d, idx) => {
    const r = doc(itemsCol);
    const title = typeof d === 'string' ? d : (d?.title ?? '');
    const priority = typeof d === 'object' ? !!d?.priority : false;
    b2.set(r, { title, priority, order: idx, checked: false, expireAt: expiryFor(date) });
  });
  await b2.commit();
};


  const onToggle = async (item: Item) => {
    if (!me || locked) return;
    const ref = doc(itemsCol, item.id);

    if (!item.checked) {
      await updateDoc(ref, {
        checked: true,
        checkedByUID: me.uid,
        checkedByName: me.name,
        checkedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        checked: false,
        checkedByUID: deleteField(),
        checkedByName: deleteField(),
        checkedAt: deleteField(),
      });
    }
  };

  const onApplyTemplateNow = async () => {
    if (!me?.isAdmin) return;
    if (!confirm('Apply the latest template to THIS DAY? Existing items will be replaced.')) return;
    await reseedFromTemplate();
    alert('Template applied.');
  };

  const onSubmitChecklist = async () => {
    if (!me || locked) return;
    if (!confirm('Submit and lock this checklist? You will not be able to edit after submitting.')) return;
    await updateDoc(shiftRef, {
      locked: true,
      completedAt: serverTimestamp(),
      completedByUID: me.uid,
      completedByName: me.name,
    });
  };

  const fmt = (ts?: any) => {
    if (!ts) return '';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleString();
    } catch { return ''; }
  };

  return (
    <SessionGate>
      <main className="p-6 max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Link href="/" className="inline-flex items-center px-3 py-2 rounded border hover:bg-slate-50">← Home</Link>
              <h1 className="text-2xl font-semibold">{title}</h1>
            </div>
            <Link href={`/r/${restId}`} className="text-sm underline">Back to date/shift</Link>
          </div>
          <SignOutButton />
        </header>

        <div className="rounded-xl border p-4">
          {seeding && <p>Preparing checklist…</p>}

          {!seeding && items.length === 0 && (
            <p className="text-slate-600">No duties configured for this shift. Add some in Admin Settings.</p>
          )}

          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 p-3 rounded-lg border">
                <button
                  disabled={locked}
                  onClick={() => onToggle(item)}
                  className={`mt-1 h-6 w-6 rounded border grid place-items-center ${
                    item.checked ? 'bg-green-600 text-white' : 'bg-white'
                  }`}
                  aria-pressed={!!item.checked}
                  title={item.checked ? 'Uncheck' : 'Tap to sign off'}
                >
                  {item.checked ? '✓' : ''}
                </button>
                <div className="flex-1">
                  <div className={`font-medium ${item.priority ? 'text-red-600' : ''}`}>{item.title}</div>
                  {item.checked && (
                    <div className="text-xs text-slate-600 mt-1">
                      Signed by <span className="font-medium">{item.checkedByName}</span> at {fmt(item.checkedAt)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap gap-2 items-center justify-between">
            {completed ? (
              <div className="text-sm text-slate-600">
                Submitted by <span className="font-medium">{completed.by}</span> at {fmt(completed.at)}
              </div>
            ) : (
              <div className="text-sm text-slate-600">Not submitted</div>
            )}

            <div className="flex gap-2">
              {me?.isAdmin && !locked && (
                <button
                  onClick={onApplyTemplateNow}
                  className="px-3 py-2 rounded border"
                  title="Replace items with the latest template (admin)"
                >
                  Apply template to this day
                </button>
              )}
              <button
                disabled={locked}
                onClick={onSubmitChecklist}
                className={`px-4 py-2 rounded ${locked ? 'bg-slate-300 text-slate-600' : 'bg-slate-800 text-white'}`}
                title={locked ? 'Already locked' : 'Submit and lock'}
              >
                {locked ? 'Locked' : 'Submit checklist'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </SessionGate>
  );
}
