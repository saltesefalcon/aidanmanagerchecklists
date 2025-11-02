'use client';

import { useEffect, useMemo, useState } from 'react';
import SessionGate from '@/components/SessionGate';
import SignOutButton from '@/components/SignOutButton';
import {
  collection, getDocs, doc, onSnapshot, setDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

type DutyTemplates = { open: string[]; mid: string[]; close: string[]; };
type Shift = 'open' | 'mid' | 'close';
type Restaurant = { id: string; name: string };

const EMPTY: DutyTemplates = { open: [], mid: [], close: [] };

export default function SettingsPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restId, setRestId] = useState<string>('');
  const [shift, setShift] = useState<Shift>('open');
  const [templates, setTemplates] = useState<DutyTemplates>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [newDuty, setNewDuty] = useState('');
  const [bulkText, setBulkText] = useState('');

  // Load restaurant list
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'restaurants'));
      const list = snap.docs.map(d => ({ id: d.id, name: (d.data().name as string) ?? d.id }));
      setRestaurants(list);
      if (!restId && list.length) setRestId(list[0].id);
    })();
  }, []); // eslint-disable-line

  // Live subscribe to settings/config for selected restaurant
  useEffect(() => {
    if (!restId) return;
    setLoading(true);
    const ref = doc(db, 'restaurants', restId, 'settings', 'config');
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      const dt: DutyTemplates = data?.dutyTemplates ?? EMPTY;
      // normalize to arrays
      setTemplates({
        open: Array.isArray(dt.open) ? dt.open : [],
        mid: Array.isArray(dt.mid) ? dt.mid : [],
        close: Array.isArray(dt.close) ? dt.close : [],
      });
      setLoading(false);
    });
    return () => unsub();
  }, [restId]);

  const saveTemplates = async (next: DutyTemplates) => {
    const ref = doc(db, 'restaurants', restId, 'settings', 'config');
    await setDoc(ref, { dutyTemplates: next }, { merge: true });
  };

  const addDuty = async () => {
    const title = newDuty.trim();
    if (!title) return;
    const next = { ...templates, [shift]: [...templates[shift], title] };
    setTemplates(next);
    setNewDuty('');
    await saveTemplates(next);
  };

  const replaceFromBulk = async () => {
    // one duty per line; ignore blanks
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    const next = { ...templates, [shift]: lines };
    setTemplates(next);
    await saveTemplates(next);
  };

  const removeDuty = async (idx: number) => {
    const list = [...templates[shift]];
    list.splice(idx, 1);
    const next = { ...templates, [shift]: list };
    setTemplates(next);
    await saveTemplates(next);
  };

  const updateDuty = async (idx: number, text: string) => {
    const list = [...templates[shift]];
    list[idx] = text;
    const next = { ...templates, [shift]: list };
    setTemplates(next);
    await saveTemplates(next);
  };

  const duties = templates[shift];

  return (
    <SessionGate requireAdmin>
      <main className="p-6 max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Admin Settings</h1>
          <SignOutButton />
        </header>

        {/* Restaurant picker */}
        <section className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <label>
            <span className="text-sm">Restaurant</span>
            <select
              className="mt-1 w-full border rounded px-3 py-2"
              value={restId}
              onChange={(e) => setRestId(e.target.value)}
            >
              {restaurants.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>

          {/* Shift tabs */}
          <div className="space-y-1">
            <span className="text-sm">Shift</span>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(['open','mid','close'] as Shift[]).map(s => (
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

        {/* Duties editor */}
        <section className="rounded-xl border p-4">
          <div className="mb-3">
            <h2 className="text-lg font-medium">Duties for {shift.toUpperCase()}</h2>
            <p className="text-sm text-slate-600">Add, edit, or remove duties. Changes save immediately.</p>
          </div>

          {loading ? (
            <p>Loading…</p>
          ) : (
            <div className="space-y-3">
              {duties.map((duty, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="flex-1 border rounded px-3 py-2"
                    value={duty}
                    onChange={(e) => updateDuty(i, e.target.value)}
                  />
                  <button
                    className="px-3 py-2 rounded border"
                    onClick={() => removeDuty(i)}
                    title="Remove"
                  >
                    ✕
                  </button>
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
                <label className="block text-sm mb-1">
                  Bulk replace (one duty per line)
                </label>
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
      </main>
    </SessionGate>
  );
}
