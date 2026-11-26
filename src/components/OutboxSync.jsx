import { useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { startOutboxSync } from '../lib/outbox';
import { registerOfflineCheckins, refreshPro, OFFLINE_CHECKIN_SYNCED_EVENT } from '../lib/offlineCheckins';
import { submitReview } from '../lib/reviews';
import { registerMissionPhotos } from '../lib/missionPhotoQueue';
import { registerPhotoQueue } from '../lib/photoQueue';
import { registerMissionAnswers } from '../lib/missionAnswerQueue';
import { registerPhotoBonus, queuePhotoBonus } from '../lib/photoBonusQueue';

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
        // Photos taken with it: the photo bonus is checked in the background.
        if (out.saved && out.verified && (job.payload.photoURLs?.length || job.files?.length)) {
          queuePhotoBonus({ uid: job.uid, landmarkId: job.payload.landmarkId, landmark: { id: job.payload.landmarkId, region: job.payload.region, name: job.payload.landmarkName } }).catch(() => {});
        }
        try {
          window.dispatchEvent(new CustomEvent(OFFLINE_CHECKIN_SYNCED_EVENT, { detail: { landmarkId: job.payload.landmarkId, landmarkName: job.payload.landmarkName, region: job.payload.region || null, saved: !!out.saved, verified: !!out.verified, sameDay: !!out.sameDay, awarded: Number(out.awarded) || 0 } }));
        } catch {
          /* no window */
        }
      },
    });
    registerMissionPhotos();
    registerPhotoQueue();
    registerMissionAnswers();
    registerPhotoBonus();
    return startOutboxSync(() => uidRef.current);
  }, []);

  // Pro, refreshed while online, so the phone knows its offline limit.
  useEffect(() => {
    if (user?.uid) refreshPro(user.uid).catch(() => {});
  }, [user?.uid]);

  return null;
}
