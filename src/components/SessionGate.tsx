'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

type MCUserProfile = {
  email: string;
  displayName?: string;
  role: 'admin' | 'manager';
  // restaurants map, e.g. { tulia: true, beacon: true }
  restaurants: Record<string, boolean>;
};

export default function SessionGate({
  children,
  requireAdmin = false,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [fbUser, setFbUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MCUserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u) {
          setFbUser(null);
          setProfile(null);
          setLoading(false);
          router.push('/login');
          return;
        }
        setFbUser(u);
        const snap = await getDoc(doc(db, 'users', u.uid));
        if (!snap.exists()) {
          setError('No user profile found. Ask an admin to create users/{uid}.');
          setLoading(false);
          return;
        }
        const data = snap.data() as MCUserProfile;
        setProfile(data);
        setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? 'Auth/profile load failed');
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-slate-600">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-2">Access issue</h1>
        <p className="mb-4">{error}</p>
        <button
          className="px-4 py-2 rounded bg-slate-800 text-white"
          onClick={() => signOut(auth)}
        >
          Sign out
        </button>
      </div>
    );
  }

  if (!fbUser || !profile) return null;

  if (requireAdmin && profile.role !== 'admin') {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-2">Admins only</h1>
        <p className="mb-4">Your account is not an admin.</p>
        <button
          className="px-4 py-2 rounded bg-slate-800 text-white"
          onClick={() => signOut(auth)}
        >
          Sign out
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
