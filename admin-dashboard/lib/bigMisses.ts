'use client';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { clientFirebase } from './firestore';
import type { MissStatus } from './types';

// Saves a big miss's review. firestore.rules lets the dashboard identity
// change only reviewed / status / resolution / reviewedAt.
export async function saveMissReview(id: string, status: MissStatus, resolution: string) {
  const fb = clientFirebase();
  if (!fb) throw new Error('Firebase is not configured.');
  await updateDoc(doc(fb.db, 'big_misses', id), {
    status,
    reviewed: status !== 'pending',
    resolution: resolution.slice(0, 2000),
    reviewedAt: serverTimestamp(),
  });
}

export const statusLabel = (s?: MissStatus) => (s === 'resolved' ? 'Resolved' : s === 'duplicate' ? 'Duplicate' : 'Pending review');
