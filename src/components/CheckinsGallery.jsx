import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getLandmark, getRegion } from '../data/regions';
import { getCustomLandmarks } from '../lib/customLandmarks';
import { getUserCheckins, updateCheckinTimestamp, isRealCheckin } from '../lib/leaderboard';
import { getMyReview } from '../lib/reviews';
import { isRateable, tierById, tierStars } from '../lib/ratingFlow';
import { CHECKIN_SORTS, sortCheckins } from '../lib/checkinSort';
import { useAdminMode } from '../lib/AdminModeContext';
import { isAdmin } from '../lib/admins';
import { useAuth } from '../lib/AuthContext';
import { regionTimezone, tzAbbrev, toZonedInputValue, fromZonedInputValue } from '../lib/timezones';
import { friendlyError } from '../lib/friendlyError';
import { SkeletonGrid, SkeletonList } from './Skeleton';
import ErrorNotice from './ErrorNotice';
import MyCommentEditor from './MyCommentEditor';
import { matchesSearch } from '../lib/search';
import { useSmartSearch } from '../lib/smartSearch';
import SmartSearchLabel from './SmartSearchLabel';


// Marks where AI-understood matches start in the list.
const SMART_DIVIDER = { id: '__smart__' };

// Shared "Sep 7, 2026, 10:04 AM" formatting for check-in timestamps.
function fmtDateTime(seconds) {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// The full photo gallery of everywhere you've checked in -- lives on the
// Full Stats page (moved out of the Ranks tab strip, which is now just
// This Week / This Month / This Year).
export default function CheckinsGallery({ user, claimedMap, navigate, totalPoints, title = 'My Check-ins' }) {
  const { user: viewer } = useAuth();
  const { adminMode } = useAdminMode();
  const canEditDates = adminMode && isAdmin(viewer?.email);
  // Only your own gallery gets comment editing, not a friend's.
  const isOwnGallery = !!viewer && viewer.uid === user?.uid;
  const [checkins, setCheckins] = useState(null);
  // A failed read is its own state -- never shown as "No check-ins yet".
  const [loadError, setLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [layout, setLayout] = useState('list'); // 'list' | 'grid'
  const [search, setSearch] = useState('');
  // Admin Mode: which row's "when I checked in" is being edited, if any.
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const startEdit = (it) => {
    // Grid tiles have no room for the inline date/time editor -- hand off
    // to List view (where it lives) already opened to this check-in.
    setLayout('list');
    setEditingId(it.id);
    setEditValue(toZonedInputValue(it.createdAt, regionTimezone(it.regionId, it.lng)));
    setEditError('');
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditError('');
  };
  const saveEdit = async (it) => {
    if (!editValue) return;
    // The picker holds the landmark's OWN local wall-clock time, not the
    // admin's device time -- fromZonedInputValue does the timezone math to
    // get back to the real instant.
    const date = fromZonedInputValue(editValue, regionTimezone(it.regionId, it.lng));
    if (Number.isNaN(date.getTime())) {
      setEditError('Invalid date/time.');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await updateCheckinTimestamp(it.id, date);
      const seconds = Math.floor(date.getTime() / 1000);
      setCheckins((prev) =>
        prev.map((c) => (c.id === it.id ? { ...c, createdAt: seconds, date: fmtDateTime(seconds) } : c))
      );
      setEditingId(null);
    } catch (e) {
      setEditError(friendlyError(e, "Couldn't save the new date. Try again."));
    } finally {
      setEditSaving(false);
    }
  };
  const [sort, setSort] = useState(() => {
    try {
      const saved = localStorage.getItem('lh-checkins-sort');
      return CHECKIN_SORTS.some((o) => o.id === saved) ? saved : 'recent';
    } catch {
      return 'recent';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('lh-checkins-sort', sort);
    } catch {
      /* private mode */
    }
  }, [sort]);
  // Tapping a check-in navigates to its landmark page; the ErrorBoundary
  // above every route is keyed by pathname, so coming back here via the
  // Back button fully remounts this gallery instead of leaving it in
  // place -- without this, that remount always starts scrolled to the
  // top, no matter how far down the list you'd scrolled to tap something.
  // sessionStorage (not React state) is what survives that remount; the
  // path itself is the key so a friend's gallery and your own don't clash.
  const location = useLocation();
  const scrollKey = `checkins-scroll:${location.pathname}`;
  const restoredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // User-submitted landmarks aren't in the catalog; filled in once fetched
    // so their cards get the landmark's own photo and coordinates too.
    let customs = new Map();
    // `loaded` is false for the instant first paint, before reviews are read.
    const build = (c, review, loaded = false) => {
      const lm = getLandmark(c.region, c.landmarkId) || customs.get(c.landmarkId);
      // Prefer the photo saved AT check-in, then a rating photo, then the
      // landmark's stock image.
      const myPhoto = review?.photoURLs?.length ? review.photoURLs[0] : review?.photoURL || null;
      // photoURLs is the check-in's own gallery (oldest -> newest, see
      // addCheckinPhoto); show the newest, same as the landmark page does.
      const checkinPhoto = c.photoURLs?.length ? c.photoURLs[c.photoURLs.length - 1] : c.photoURL;
      const mine = checkinPhoto || myPhoto || null;
      // Only a tier rating (the chips flow) counts; a leftover star-only
      // review sorts as unrated, same as the Profile counter.
      const tier = review?.ratingTier ? tierById(review.ratingTier) : null;
      return {
        id: c.id,
        landmarkId: c.landmarkId,
        regionId: c.region,
        lng: lm?.lng ?? null,
        name: c.landmarkName || lm?.name || c.landmarkId,
        photo: mine || lm?.images?.[0] || null,
        isMine: !!mine,
        city: getRegion(c.region)?.name || (!c.region || c.region === 'null' || c.region === 'custom' ? 'Custom pin' : c.region),
        points: c.points || 0,
        createdAt: c.createdAt?.seconds || 0,
        date: fmtDateTime(c.createdAt?.seconds),
        rateable: lm ? isRateable(lm) : true,
        stars: tier ? tierStars(tier.id) : null,
        tierEmoji: tier?.emoji || null,
        tierLabel: tier?.label || null,
        comment: loaded ? review?.comment || '' : null,
      };
    };

    setLoadError(null);
    (async () => {
      let rows = [];
      try {
        rows = await getUserCheckins(user.uid);
      } catch (err) {
        if (!cancelled) setLoadError(err);
        return;
      }
      // A "Rate a Landmark" claim (ratingOnly, 0 points) isn't a visit --
      // it never belongs here, only in My Mapr Ratings.
      rows = rows.filter(isRealCheckin);
      if (cancelled) return;
      // Show right away using landmark photos, so the gallery is never blank…
      setCheckins(rows.map((c) => build(c, null)));
      // …then upgrade each tile with the user's own review via direct doc
      // reads (the reviews/{uid}_{landmarkId} doc), which the security rules
      // allow: their photo, and their rating for the rating sorts.
      const needsCustoms = rows.some((c) => !getLandmark(c.region, c.landmarkId));
      const [reviews, customList] = await Promise.all([
        Promise.all(rows.map((c) => getMyReview(user.uid, c.landmarkId).catch(() => null))),
        needsCustoms ? getCustomLandmarks().catch(() => []) : [],
      ]);
      customs = new Map(customList.map((l) => [l.id, l]));
      if (cancelled) return;
      setCheckins(rows.map((c, i) => build(c, reviews[i], true)));
    })();
    return () => {
      cancelled = true;
    };
  }, [user, claimedMap, loadAttempt]);

  // Restore once, right after the list has real content to scroll through --
  // and only once, so a later fresh visit to this same page doesn't jump to
  // some stale leftover position.
  useEffect(() => {
    if (!checkins || restoredRef.current) return;
    restoredRef.current = true;
    let saved = null;
    try {
      saved = sessionStorage.getItem(scrollKey);
      if (saved != null) sessionStorage.removeItem(scrollKey);
    } catch {
      /* blocked storage */
    }
    if (saved == null) return;
    requestAnimationFrame(() => window.scrollTo(0, Number(saved)));
  }, [checkins, scrollKey]);

  // The landmark page gets the whole gallery order in navigation state so
  // its ‹ › arrows can step to the previous / next check-in without coming
  // back here. Each step replaces the history entry, so Back still returns
  // to this list (at the saved scroll position) no matter how far you paged.
  const sorted = checkins ? sortCheckins(checkins, sort) : null;
  const hiddenCount = checkins && sorted ? checkins.length - sorted.length : 0;
  // Search by place, city, your comment, your rating or the date.
  const q = search.trim();
  const matched = sorted
    ? sorted.filter((c) => matchesSearch([c.name, c.city, c.comment, c.tierLabel, c.date].filter(Boolean).join(' '), q))
    : null;
  // AI fallback when the word search finds little: it reads your check-ins
  // (place, city, your comment) to work out which one you mean.
  const smartItems = useMemo(
    () => (sorted || []).map((c) => ({ id: c.id, text: [c.name, c.city, c.comment].filter(Boolean).join(' — ') })),
    [sorted]
  );
  const smart = useSmartSearch({ query: search, localCount: matched?.length ?? 0, items: smartItems, enabled: !!sorted });
  const smartExtra = useMemo(() => {
    const seen = new Set((matched || []).map((c) => c.id));
    return smart.ids.map((id) => (sorted || []).find((c) => c.id === id)).filter((c) => c && !seen.has(c.id));
  }, [smart.ids, matched, sorted]);
  const shown = matched ? [...matched, ...smartExtra] : null;
  // What's rendered: the plain matches, then a "Mapr thinks you mean" divider.
  const display = matched ? [...matched, ...(smartExtra.length ? [SMART_DIVIDER, ...smartExtra] : [])] : null;

  const go = (it) => {
    try {
      sessionStorage.setItem(scrollKey, String(window.scrollY));
    } catch {
      /* blocked storage -- navigation must still work */
    }
    const sequence = shown.map((c) => ({ regionId: c.regionId, landmarkId: c.landmarkId, name: c.name }));
    navigate(`/landmarks/${it.regionId}/${it.landmarkId}`, {
      state: { checkinNav: { sequence, index: shown.indexOf(it) } },
    });
  };

  return (
    <div className="section">
      <div className="card" style={{ textAlign: 'center', marginBottom: 14 }}>
        <div className="rank-hero-pts" style={{ fontSize: '1.8rem' }}>
          {totalPoints.toLocaleString()} <span>total points</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{'\u{1F4F8}'} {title} {checkins ? `(${checkins.length})` : ''}</h3>
        <div className="tabs" style={{ margin: 0 }}>
          <button className={`tab-btn ${layout === 'list' ? 'active' : ''}`} onClick={() => setLayout('list')}>
            {'\u{1F4C4}'} List
          </button>
          <button className={`tab-btn ${layout === 'grid' ? 'active' : ''}`} onClick={() => setLayout('grid')}>
            {'\u{1F5BC}\u{FE0F}'} Grid
          </button>
        </div>
      </div>

      {checkins && checkins.length > 0 && (
        <input
          type="search"
          className="checkin-search"
          name="checkin-search"
          aria-label="Search your check-ins"
          autoComplete="off"
          enterKeyHint="search"
          placeholder={'\u{1F50D} Search by place, city, or comment…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {checkins && checkins.length > 0 && (
        <div className="itin-toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <label className="itin-sort">
            <span>Sort by</span>
            <select className="radius-select" value={sort} onChange={(e) => setSort(e.target.value)}>
              {CHECKIN_SORTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {hiddenCount > 0 && (
            <span className="screen-subtitle" style={{ margin: 0, fontSize: '0.75rem' }}>
              {hiddenCount} unrateable {hiddenCount === 1 ? 'spot' : 'spots'} hidden
            </span>
          )}
        </div>
      )}

      {checkins === null && loadError && (
        <div style={{ marginTop: 12 }}>
          <ErrorNotice
            message={friendlyError(loadError, "We couldn't load these check-ins. Try again.")}
            onRetry={() => setLoadAttempt((n) => n + 1)}
          />
        </div>
      )}
      {checkins === null && !loadError && (
        <div style={{ marginTop: 12 }}>
          {layout === 'grid' ? (
            <div role="status" aria-live="polite">
              <span className="visually-hidden">Loading check-ins…</span>
              <SkeletonGrid count={9} />
            </div>
          ) : (
            <SkeletonList count={6} label="Loading check-ins" />
          )}
        </div>
      )}
      {checkins !== null && checkins.length === 0 && (
        <div className="empty-state">
          <p>No check-ins yet — find a landmark and check in with a photo! 📸</p>
        </div>
      )}
      {smart.loading && <SmartSearchLabel loading />}
      {shown && checkins.length > 0 && shown.length === 0 && !smart.loading && (
        <p className="screen-subtitle">
          {q && sorted.length > 0
            ? `No check-ins match "${q}".`
            : 'Nothing rateable here yet — switch back to Most recent to see everything.'}
        </p>
      )}

      {shown && shown.length > 0 && layout === 'list' && (
        <div style={{ marginTop: 12 }}>
          {display.map((it) =>
            it === SMART_DIVIDER ? (
              <SmartSearchLabel key={it.id} count={smartExtra.length} />
            ) : (
            <div
              key={it.id}
              className="checkin-row"
              role="button"
              tabIndex={0}
              onClick={() => go(it)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  go(it);
                }
              }}
            >
              {it.photo ? (
                <img className="checkin-list-thumb" src={it.photo} alt={it.name} loading="lazy" />
              ) : (
                <div className="checkin-thumb-blank" />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="checkin-name">{it.name}</div>
                <div className="checkin-sub">{it.tierEmoji ? `${it.tierEmoji} ${it.tierLabel}` : 'Not rated yet'}</div>
                {canEditDates && editingId === it.id ? (
                  <div
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="datetime-local"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      disabled={editSaving}
                      style={{ fontSize: '0.78rem', padding: '4px 6px' }}
                    />
                    <span className="tag" style={{ fontSize: '0.68rem' }}>
                      {tzAbbrev(regionTimezone(it.regionId, it.lng))} — {it.city}
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={editSaving}
                      onClick={() => saveEdit(it)}
                    >
                      {editSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={editSaving} onClick={cancelEdit}>
                      Cancel
                    </button>
                    {editError && (
                      <span className="tag tag-error" style={{ fontSize: '0.7rem' }}>
                        {editError}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="checkin-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {it.date}
                    {canEditDates && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '1px 6px', fontSize: '0.7rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(it);
                        }}
                      >
                        {'\u{270F}\u{FE0F}'} Edit date
                      </button>
                    )}
                  </div>
                )}
                {isOwnGallery && it.comment !== null && (
                  <MyCommentEditor
                    compact
                    userId={user.uid}
                    landmark={{ id: it.landmarkId, name: it.name, region: it.regionId }}
                    comment={it.comment}
                    // Repeat visits to one place are separate rows sharing one
                    // comment -- keep the others in step with the edit.
                    onSaved={(text) =>
                      setCheckins((prev) =>
                        prev.map((c) => (c.landmarkId === it.landmarkId ? { ...c, comment: text } : c))
                      )
                    }
                  />
                )}
              </div>
            </div>
            )
          )}
        </div>
      )}

      {shown && shown.length > 0 && layout === 'grid' && (
        <div className="checkin-grid">
          {display.map((it) =>
            it === SMART_DIVIDER ? (
              <div key={it.id} className="checkin-grid-divider">
                <SmartSearchLabel count={smartExtra.length} />
              </div>
            ) : (
            <button type="button" key={it.id} className="checkin-tile" onClick={() => go(it)}>
              {it.photo ? (
                <img src={it.photo} alt={it.name} loading="lazy" />
              ) : (
                <div className="checkin-thumb-blank" style={{ width: '100%', height: '100%' }} />
              )}
              <span className="checkin-tile-name">{it.name}</span>
            </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
