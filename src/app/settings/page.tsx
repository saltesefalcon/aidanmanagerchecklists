'use client';

import { useEffect, useState } from 'react';
import SessionGate from '@/components/SessionGate';
import SignOutButton from '@/components/SignOutButton';
import {
  collection,
  getDocs,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
  serverTimestamp,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import { getBusinessDate } from '@/lib/bizdate';

type Shift = 'open' | 'mid' | 'close';
type Restaurant = { id: string; name: string };
type DutyItem = { title: string; priority?: boolean };
type DutyTemplates = { open: DutyItem[]; mid: DutyItem[]; close: DutyItem[] };

// Per-shift lock times (24h HH:mm stored on /settings/config)
type LockTimes = { open: string; mid: string; close: string };

const EMPTY: DutyTemplates = { open: [], mid: [], close: [] };
const DEFAULT_LOCK_TIMES: LockTimes = { open: '05:00', mid: '17:00', close: '02:30' };

function normalizeTemplates(raw: any): DutyTemplates {
  const coerce = (arr: any): DutyItem[] =>
    Array.isArray(arr)
      ? arr.map((x: any) =>
          typeof x === 'string'
            ? { title: x, priority: false }
            : { title: x?.title ?? '', priority: !!x?.priority }
        )
      : [];
  return { open: coerce(raw?.open), mid: coerce(raw?.mid), close: coerce(raw?.close) };
}

export default function SettingsPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restId, setRestId] = useState<string>('');
  const [shift, setShift] = useState<Shift>('open');
  const [templates, setTemplates] = useState<DutyTemplates>(EMPTY);
  const [lockTimes, setLockTimes] = useState<LockTimes>(DEFAULT_LOCK_TIMES);
  const [loading, setLoading] = useState(true);

  const [newDuty, setNewDuty] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [saveHint, setSaveHint] = useState<'saved' | 'dirty' | 'idle'>('idle');
  const [ltHint, setLtHint] = useState<'saved' | 'idle'>('idle');

  const [resetDate, setResetDate] = useState(getBusinessDate());

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'restaurants'));
      const list = snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? d.id }));
      setRestaurants(list);
      if (!restId && list.length) setRestId(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restId) return;
    setLoading(true);
    const ref = doc(db, 'restaurants', restId, 'settings', 'config');
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as any;

      // templates
      setTemplates(normalizeTemplates(data?.dutyTemplates ?? EMPTY));
      setSaveHint('idle');

      // lock times (with defaults)
      const lt = data?.lockTimes ?? {};
      setLockTimes({
        open: typeof lt.open === 'string' ? lt.open : DEFAULT_LOCK_TIMES.open,
        mid: typeof lt.mid === 'string' ? lt.mid : DEFAULT_LOCK_TIMES.mid,
        close: typeof lt.close === 'string' ? lt.close : DEFAULT_LOCK_TIMES.close,
      });

      setLoading(false);
    });
    return () => unsub();
  }, [restId]);

  const persist = async (next?: DutyTemplates) => {
    const payload = next ?? templates;
    const ref = doc(db, 'restaurants', restId, 'settings', 'config');
    await setDoc(ref, { dutyTemplates: payload }, { merge: true });
    setSaveHint('saved');
    setTimeout(() => setSaveHint('idle'), 1500);
  };

  // Persist lock times immediately on change
  const persistLockTimes = async (next: LockTimes) => {
    const ref = doc(db, 'restaurants', restId, 'settings', 'config');
    await setDoc(ref, { lockTimes: next }, { merge: true });
    setLtHint('saved');
    setTimeout(() => setLtHint('idle'), 1200);
  };

  // local edit helpers (mark form "dirty" until saved)
  const setListLocal = (u: (list: DutyItem[]) => DutyItem[]) => {
    const list = u(templates[shift]);
    const next = { ...templates, [shift]: list };
    setTemplates(next);
    setSaveHint('dirty');
  };

  const addDuty = () => {
    const title = newDuty.trim();
    if (!title) return;
    setListLocal((list) => [...list, { title, priority: false }]);
    setNewDuty('');
  };
  const removeDuty = (idx: number) =>
    setListLocal((list) => {
      const copy = [...list];
      copy.splice(idx, 1);
      return copy;
    });
  const updateTitle = (idx: number, text: string) =>
    setListLocal((list) => {
      const copy = [...list];
      copy[idx] = { ...copy[idx], title: text };
      return copy;
    });
  const togglePriority = (idx: number, v: boolean) =>
    setListLocal((list) => {
      const copy = [...list];
      copy[idx] = { ...copy[idx], priority: v };
      return copy;
    });
  const moveUp = (idx: number) =>
    setListLocal((list) => {
      if (idx === 0) return list;
      const copy = [...list];
      [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
      return copy;
    });
  const moveDown = (idx: number) =>
    setListLocal((list) => {
      if (idx === list.length - 1) return list;
      const copy = [...list];
      [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
      return copy;
    });

  const replaceFromBulk = () => {
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    setTemplates({ ...templates, [shift]: lines.map((t) => ({ title: t, priority: false })) });
    setSaveHint('dirty');
  };

  // Reset a specific date from current template (UNLOCK → WIPE → RESEED)
  const resetDayFromTemplate = async () => {
    if (!restId || !resetDate) return;
    if (
      !confirm(
        `Reset ${restId} ${resetDate} ${shift.toUpperCase()} from template?\nThis will DELETE existing items for that shift/date and reseed.`
      )
    )
      return;

    const itemsCol = collection(
      db,
      'restaurants',
      restId,
      'checklists',
      resetDate,
      'shifts',
      shift,
      'items'
    );
    const sref = doc(db, 'restaurants', restId, 'checklists', resetDate, 'shifts', shift);

    try {
      // 1) unlock / ensure shift FIRST so deletes pass rules (shiftUnlocked())
      await setDoc(sref, { locked: false, createdAt: Timestamp.now() }, { merge: true });

      // 2) wipe items
      const snap = await getDocs(itemsCol);
      const batch = writeBatch(db);
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      // 3) reseed from current template with order/priority
      const batch2 = writeBatch(db);
      templates[shift].forEach((d, idx) => {
        const r = doc(itemsCol);
        batch2.set(r, { title: d.title, priority: !!d.priority, order: idx, checked: false });
      });
      await batch2.commit();

      alert('Checklist reset and reseeded from template.');
    } catch (e: any) {
      console.error('Reset failed', e);
      alert(`Reset failed: ${e?.message ?? e}`);
    }
  };

  const duties = templates[shift];

  return (
    <SessionGate requireAdmin>
      <main className="p-6 max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex items-center px-3 py-2 rounded border hover:bg-slate-50">
              ← Home
            </Link>
            <h1 className="text-2xl font-semibold">Admin Settings</h1>
          </div>
          <SignOutButton />
        </header>

        {/* pickers */}
        <section className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <label>
            <span className="text-sm">Restaurant</span>
            <select
              className="mt-1 w-full border rounded px-3 py-2"
              value={restId}
              onChange={(e) => setRestId(e.target.value)}
            >
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1 sm:col-span-2">
            <span className="text-sm">Shift</span>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(['open', 'mid', 'close'] as Shift[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setShift(s)}
                  className={`py-2 rounded border ${shift === s ? 'bg-slate-800 text-white' : ''}`}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Lock times (persist immediately) */}
        <section className="rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-medium">Lock times (per location)</h2>
            <span className="text-sm text-slate-600">{ltHint === 'saved' ? 'Saved' : ''}</span>
          </div>
          <p className="text-sm text-slate-600 mb-3">
            After the lock time passes for a shift, that day’s checklist will auto-submit and lock.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-sm">OPEN lock time</span>
              <input
                type="time"
                className="mt-1 w-full border rounded px-3 py-2"
                value={lockTimes.open}
                onChange={(e) => {
                  const next = { ...lockTimes, open: e.target.value || '' };
                  setLockTimes(next);
                  persistLockTimes(next);
                }}
              />
            </label>
            <label className="block">
              <span className="text-sm">MID lock time</span>
              <input
                type="time"
                className="mt-1 w-full border rounded px-3 py-2"
                value={lockTimes.mid}
                onChange={(e) => {
                  const next = { ...lockTimes, mid: e.target.value || '' };
                  setLockTimes(next);
                  persistLockTimes(next);
                }}
              />
            </label>
            <label className="block">
              <span className="text-sm">CLOSE lock time</span>
              <input
                type="time"
                className="mt-1 w-full border rounded px-3 py-2"
                value={lockTimes.close}
                onChange={(e) => {
                  const next = { ...lockTimes, close: e.target.value || '' };
                  setLockTimes(next);
                  persistLockTimes(next);
                }}
              />
            </label>
          </div>
        </section>

        {/* editor */}
        <section className="rounded-xl border p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Duties for {shift.toUpperCase()}</h2>
              <p className="text-sm text-slate-600">
                Edit, mark <span className="font-medium">Priority</span>, and reorder with ↑/↓.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => persist()}
                className="px-3 py-2 rounded bg-slate-800 text-white"
                title="Save changes"
              >
                Save changes
              </button>
              <span className="text-sm text-slate-600">
                {saveHint === 'dirty' && 'Unsaved changes'}
                {saveHint === 'saved' && 'Saved'}
              </span>
            </div>
          </div>

          {loading ? (
            <p>Loading…</p>
          ) : (
            <div className="space-y-3">
              {duties.map((duty, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="flex-1 border rounded px-3 py-2"
                    value={duty.title}
                    onChange={(e) => updateTitle(i, e.target.value)}
                  />
                  <label className="text-sm flex items-center gap-1 px-2 select-none">
                    <input
                      type="checkbox"
                      checked={!!duty.priority}
                      onChange={(e) => togglePriority(i, e.target.checked)}
                    />
                    Priority
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      className="px-2 py-2 rounded border"
                      disabled={i === 0}
                      onClick={() => moveUp(i)}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="px-2 py-2 rounded border"
                      disabled={i === duties.length - 1}
                      onClick={() => moveDown(i)}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button className="px-3 py-2 rounded border" onClick={() => removeDuty(i)} title="Remove">
                      ✕
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-2 pt-2">
                <input
                  className="flex-1 border rounded px-3 py-2"
                  placeholder="New duty title…"
                  value={newDuty}
                  onChange={(e) => setNewDuty(e.target.value)}
                />
                <button className="px-4 py-2 rounded bg-slate-800 text-white" onClick={addDuty}>
                  Add
                </button>
              </div>

              <div className="pt-4">
                <label className="block text-sm mb-1">Bulk replace (one duty per line)</label>
                <textarea
                  className="w-full min-h-[120px] border rounded p-3"
                  placeholder={`e.g.\nCount cash drawer\nSweep front entry\n…`}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                />
                <div className="pt-2">
                  <button className="px-4 py-2 rounded border" onClick={replaceFromBulk}>
                    Replace list from text
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Reset from template */}
        <section className="rounded-xl border p-4">
          <h3 className="text-lg font-medium mb-2">Reset a day from current template</h3>
          <p className="text-sm text-slate-600">
            Deletes existing items for the selected <b>{shift.toUpperCase()}</b> and reseeds in the new order/priority.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <label className="text-sm">
              Date&nbsp;
              <input
                type="date"
                value={resetDate}
                onChange={(e) => setResetDate(e.target.value)}
                className="border rounded px-2 py-1"
              />
            </label>
            <button onClick={resetDayFromTemplate} className="px-3 py-2 rounded border">
              Reset from template
            </button>
          </div>
        </section>
      </main>
    </SessionGate>
  );
}
