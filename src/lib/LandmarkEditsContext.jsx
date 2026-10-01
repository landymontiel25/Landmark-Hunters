import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getLandmarkEdits, getLandmarkOverrides } from './landmarkOverrides';

const LandmarkEditsContext = createContext(null);

// Admin Mode's live corrections to built-in landmarks -- loaded once,
// app-wide, so every screen that shows a static catalog landmark (map,
// detail page, landmark list) can apply the same patch instead of each
// fetching/merging it separately. Small, rarely-changing collection
// (nothing here happens except when the admin edits something), so one
// shared load is plenty -- no per-screen re-fetching.
export function LandmarkEditsProvider({ children }) {
  const [edits, setEdits] = useState({});
  // Admin drag-to-fix pin positions ("regionId/id" -> { lat, lng }). Loaded
  // here too so the detail page's check-in/directions, the landmark list's
  // distances and every other screen use the corrected spot, not just the map.
  const [positions, setPositions] = useState({});

  const reload = useCallback(() => {
    getLandmarkEdits()
      .then(setEdits)
      .catch(() => {
        /* offline / rules not deployed yet -- landmarks just show their static data */
      });
    getLandmarkOverrides()
      .then(setPositions)
      .catch(() => {
        /* same: static positions */
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Applies a live edit (if any) on top of a built-in landmark object.
  // Safe to call with null/undefined -- returns it unchanged.
  const applyEdit = useCallback(
    (landmark) => {
      if (!landmark) return landmark;
      // Catalog entries carry `region`; list/map copies add `regionId`.
      const key = `${landmark.regionId ?? landmark.region}/${landmark.id}`;
      const edit = edits[key];
      const pos = positions[key];
      if (!edit && !pos) return landmark;
      return { ...landmark, ...edit, ...(pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng) ? { lat: pos.lat, lng: pos.lng } : {}) };
    },
    [edits, positions]
  );

  return (
    <LandmarkEditsContext.Provider value={{ edits, positions, applyEdit, reload }}>{children}</LandmarkEditsContext.Provider>
  );
}

export function useLandmarkEdits() {
  const ctx = useContext(LandmarkEditsContext);
  if (!ctx) throw new Error('useLandmarkEdits must be used inside LandmarkEditsProvider');
  return ctx;
}
