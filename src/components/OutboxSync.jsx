import { useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { startOutboxSync } from '../lib/outbox';
import { registerOfflineCheckins, refreshPro, OFFLINE_CHECKIN_SYNCED_EVENT } from '../lib/offlineCheckins';
import { submitReview } from '../lib/reviews';

// Keeps the phone's outbox moving (outbox.js): on launch, when the phone is
// back online, when the app comes back to the front, and every minute while
// anything waits. Renders nothing.
export default function OutboxSync() {
  const { user } = useAuth();
  const uidRef = useRef(null);
  uidRef.current = user?.uid || null;

  useEffect(() => {
    registerOfflineCheckins({
      saveReview: (review) => submitReview({ ...review, photoFiles: [] }, { source: 'offline-checkin' }),
      onSynced: (job, out) => {
        try {
          window.dispatchEvent(new CustomEvent(OFFLINE_CHECKIN_SYNCED_EVENT, { detail: { landmarkId: job.payload.landmarkId, saved: !!out.saved, verified: !!out.verified } }));
        } catch {
          /* no window */
        }
      },
    });
    return startOutboxSync(() => uidRef.current);
  }, []);

  // Pro, refreshed while online, so the phone knows its offline limit.
  useEffect(() => {
    if (user?.uid) refreshPro(user.uid).catch(() => {});
  }, [user?.uid]);

  return null;
}
