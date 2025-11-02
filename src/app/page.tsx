'use client';

import Link from 'next/link';
import SessionGate from '@/components/SessionGate';
import SignOutButton from '@/components/SignOutButton';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

type Profile = {
  displayName?: string;
  role: 'admin' | 'manager';
  restaurants: Record<string, boolean>;
};

export default function Home() {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      const snap = await getDoc(doc(db, 'users', u.uid));
      setProfile(snap.exists() ? (snap.data() as Profile) : null);
    });
    return () => unsub();
  }, []);

  const allowed = profile ? Object.keys(profile.restaurants || {}).filter(k => profile.restaurants[k]) : [];

  return (
    <SessionGate>
      <main className="p-6 max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Manager Checklists</h1>
          <SignOutButton />
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">Choose a restaurant</h2>
          <div className="grid grid-cols-2 gap-3">
            {allowed.map((id) => (
              <Link
                key={id}
                href={`/r/${id}`}
                className="rounded-xl border p-4 hover:bg-slate-50"
              >
                {id.charAt(0).toUpperCase() + id.slice(1)}
              </Link>
            ))}
          </div>
          {profile?.role === 'admin' && (
            <div className="pt-4">
              <Link href="/settings" className="underline">Admin Settings</Link>
            </div>
          )}
        </section>
      </main>
    </SessionGate>
  );
}
