import { getLandmark, canonicalLandmarkId } from '../../src/data/regions.js';
import { ensureServerPlacePacks } from './placePacks.js';
import { isApprovedLandmark } from '../../src/lib/landmarkApproval.js';

// The place as the server knows it: catalog and place packs first, then a
// user-added landmark. A pending user-added place counts only once the
// owner approved it (or it was grandfathered).
export async function loadPlace(db, region, landmarkId) {
  await ensureServerPlacePacks();
  const id = canonicalLandmarkId(landmarkId, region);
  const known = (region && getLandmark(region, id)) || null;
  if (known) return known;
  const snap = await db.collection('custom_landmarks').doc(landmarkId).get();
  return snap.exists && isApprovedLandmark(snap.data()) ? snap.data() : null;
}
