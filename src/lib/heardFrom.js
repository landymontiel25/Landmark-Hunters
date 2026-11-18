import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

// "How did you hear about Landmark Hunters?" (owner, 2026-11-18): asked once,
// at the end of a new account's onboarding, after sign-up. One tap, optional.
// Saved to the owner-only private doc (users/{uid}/private/main), never the
// public profile. firestore.rules checks the id against this same list.
export const HEARD_FROM = [
  { id: 'tv', label: 'T.V.' },
  { id: 'airline', label: 'Airline' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'airport', label: 'Airport' },
  { id: 'tour-guide', label: 'Tour guide' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'friend-family', label: 'Friend or family' },
  { id: 'google', label: 'Google search' },
  { id: 'app-store', label: 'App Store' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'news-blog', label: 'News article or blog' },
  { id: 'other', label: 'Other' },
];

export const isHeardFromId = (id) => HEARD_FROM.some((o) => o.id === id);

export async function saveHeardFrom(uid, id) {
  if (!db || !uid || !isHeardFromId(id)) return;
  await setDoc(doc(db, 'users', uid, 'private', 'main'), { heardFrom: id, heardFromAt: Date.now() }, { merge: true });
}
