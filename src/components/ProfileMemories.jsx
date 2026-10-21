import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useMyPhotos } from '../lib/MyPhotosContext';
import { getUserCheckins, isRealCheckin } from '../lib/leaderboard';
import { oneVisitPerDay } from '../lib/realCheckin';
import { getLandmark } from '../data/regions';

// Your memories as photo tiles at the top of Profile (owner, 2026-10-20),
// newest first, one per place per day like My Memories. One row shows at
// first; "Show more" opens the rest in a box that scrolls on its own
// without scrolling the page, the same as All Badges on Full Stats. The box
// scrolls on a wrapper, not on the grid itself: iPhone Safari squeezes a
// height-capped grid's rows into slivers instead of scrolling them.
const PER_ROW = 3;

export default function ProfileMemories() {
  const { user, firebaseEnabled } = useAuth();
  const { claimedMap } = useCheckIn();
  const { myPhotos } = useMyPhotos();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState({ uid: null, rows: null });
  const [open, setOpen] = useState(false);
  const uid = user?.uid;

  useEffect(() => {
    if (!firebaseEnabled || !uid) return undefined;
    let cancelled = false;
    getUserCheckins(uid)
      .then((all) => {
        if (cancelled) return;
        const rows = oneVisitPerDay(all.filter(isRealCheckin)).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setLoaded({ uid, rows });
      })
      .catch(() => !cancelled && setLoaded({ uid, rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [firebaseEnabled, uid, claimedMap]);

  const rows = loaded.uid === uid ? loaded.rows : null;
  if (!firebaseEnabled || !user || !rows || rows.length === 0) return null;

  const tiles = rows.map((c) => {
    const lm = getLandmark(c.region, c.landmarkId);
    const own = c.photoURLs?.length ? c.photoURLs[c.photoURLs.length - 1] : c.photoURL;
    return {
      id: c.id,
      regionId: c.region,
      landmarkId: c.landmarkId,
      name: c.landmarkName || lm?.name || c.landmarkId,
      photo: own || myPhotos[c.landmarkId]?.[0] || lm?.images?.[0] || null,
    };
  });
  const shown = open ? tiles : tiles.slice(0, PER_ROW);

  return (
    <div className="card section profile-memories">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>
          {'\u{1F4F8}'} My Memories ({tiles.length})
        </h3>
        <button type="button" className="btn btn-ghost btn-tight" onClick={() => navigate('/checkins', { state: { layout: 'grid' } })}>
          See all ›
        </button>
      </div>
      <div className={open ? 'profile-memories-scroll' : undefined}>
        <div className="checkin-grid">
          {shown.map((t) => (
            <button type="button" key={t.id} className="checkin-tile" onClick={() => navigate(`/landmarks/${t.regionId}/${t.landmarkId}`)}>
              {t.photo ? (
                <img src={t.photo} alt={t.name} loading="lazy" decoding="async" />
              ) : (
                <div className="checkin-thumb-blank" style={{ width: '100%', height: '100%' }} />
              )}
              <span className="checkin-tile-name">{t.name}</span>
            </button>
          ))}
        </div>
      </div>
      {tiles.length > PER_ROW && (
        <button type="button" className="btn btn-ghost btn-sm badges-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : `Show more (${tiles.length - PER_ROW})`}
        </button>
      )}
    </div>
  );
}
