'use client';
import type { MissStatus } from './types';

// Saves a big miss's review through the server (/api/firestore-read), which
// changes only reviewed / status / resolution / reviewedAt.
export async function saveMissReview(id: string, status: MissStatus, resolution: string) {
  const r = await fetch('/api/firestore-read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'review', id, status, resolution: resolution.slice(0, 2000) }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Could not save the review (${r.status}).`);
  // The route answers 200 with { ok: false } when the miss doc is gone.
  if (body.ok === false) throw new Error('Could not save the review: that miss no longer exists. Refresh the list.');
}

export const statusLabel = (s?: MissStatus) => (s === 'resolved' ? 'Resolved' : s === 'duplicate' ? 'Duplicate' : 'Pending review');
