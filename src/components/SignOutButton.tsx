'use client';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export default function SignOutButton() {
  return (
    <button
      type="button"
      className="px-3 py-2 rounded bg-slate-800 text-white"
      onClick={() => signOut(auth)}
    >
      Sign out
    </button>
  );
}
