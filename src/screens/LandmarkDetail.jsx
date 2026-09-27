import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getLandmark, getRegion, INTERESTS } from '../data/regions';
import { getCustomLandmark, reportCustomLandmark } from '../lib/customLandmarks';
import { useAdminMode } from '../lib/AdminModeContext';
import { useLandmarkEdits } from '../lib/LandmarkEditsContext';
import { isAdmin } from '../lib/admins';
import AdminEditLandmarkPanel from '../components/AdminEditLandmarkPanel';
import AdminEditBuiltInPanel from '../components/AdminEditBuiltInPanel';
import { blockUser, listBlockedUsers } from '../lib/blocks';
import { useTrip } from '../lib/TripContext';
import { useGeo } from '../lib/GeoContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useRatings } from '../lib/RatingsContext';
import { useMyPhotos } from '../lib/MyPhotosContext';
import { useFriends } from '../lib/FriendsContext';
import {
  submitReview,
  getMyReview,
  getLandmarkReviews,
  reportReview,
  deleteMyReview,
  ratingDraftKey,
} from '../lib/reviews';
import { isRateable, tierById } from '../lib/ratingFlow';
import {
  getMyCheckin,
  getVisitCount,
  addCheckinPhoto,
  removeCheckinPhoto,
  updateCheckinTimestamp,
  MAX_CHECKIN_PHOTOS,
} from '../lib/leaderboard';
import { regionTimezone, tzAbbrev, toZonedInputValue, fromZonedInputValue } from '../lib/timezones';
import RatingFlow from '../components/RatingFlow';
import MyCommentEditor from '../components/MyCommentEditor';
import LandmarkPostcard from '../components/LandmarkPostcard';
import Lightbox from '../components/Lightbox';
import ReviewReplies from '../components/ReviewReplies';
import CheckInButton from '../components/CheckInButton';
import RatingStars from '../components/RatingStars';
import DirectionsButton from '../components/DirectionsButton';
import { pickPhoto } from '../lib/imageUtils';
import { LandmarkDetailSkeleton, Skeleton, SkeletonList } from '../components/Skeleton';
import ErrorNotice from '../components/ErrorNotice';
import { friendlyError } from '../lib/friendlyError';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { clearPersisted } from '../lib/usePersistentState';

const CATEGORY_LABEL = Object.fromEntries(INTERESTS.map((i) => [i.id, i.label]));

// Newest-added check-in photo first: photoURLs is stored oldest->newest
// (each add appends via arrayUnion), so this reverses it before it ever
// gets prepended onto myPhotos -- the photo you most recently added stays
// the landmark's lead photo, not whichever you added first. Folds in the
// legacy single photoURL field too, if it isn't already among photoURLs.
function checkinPhotosNewestFirst(checkin) {
  const photos = [...(checkin?.photoURLs || [])].reverse();
  if (checkin?.photoURL && !photos.includes(checkin.photoURL)) photos.push(checkin.photoURL);
  return photos;
}

// "Tuesday, Sep 15 at 3:47 PM"
function fmtCheckinTime(seconds) {
  const d = new Date(seconds * 1000);
  const day = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

const FACTS_PREVIEW = 5;

export default function LandmarkDetail() {
  const { region: regionId, id } = useParams();
  const navigate = useNavigate();
  // Set when you arrived from a check-ins gallery: the gallery's full order
  // plus this landmark's position in it, so the header can offer ‹ › to
  // step through your check-ins one by one.
  const location = useLocation();
  const checkinNav = location.state?.checkinNav || null;
  const navPrev = checkinNav && checkinNav.index > 0 ? checkinNav.sequence[checkinNav.index - 1] : null;
  const navNext =
    checkinNav && checkinNav.index < checkinNav.sequence.length - 1 ? checkinNav.sequence[checkinNav.index + 1] : null;
  const stepCheckin = (delta) => {
    const index = checkinNav.index + delta;
    const target = checkinNav.sequence[index];
    if (!target) return;
    window.scrollTo(0, 0);
    navigate(`/landmarks/${target.regionId}/${target.landmarkId}`, {
      replace: true,
      state: { checkinNav: { ...checkinNav, index } },
    });
  };
  const { toggleLandmark, getRegionSelection, updateTrip, setMapFocus, setMapFocusPoint } = useTrip();
  const { user, firebaseEnabled, claimedMap, checkingIn, checkIn } = useCheckIn();
  const { adminMode } = useAdminMode();
  const { applyEdit, reload: reloadLandmarkEdits } = useLandmarkEdits();
  const { coords } = useGeo();
  const region = getRegion(regionId);
  const staticLandmark = getLandmark(regionId, id);
  // Not in the built-in catalog -- might be a user-submitted one from
  // "Add Landmark" on the map, so fetch it from Firestore by the same id.
  const [customLandmark, setCustomLandmark] = useState(null);
  const [customLoading, setCustomLoading] = useState(!staticLandmark);
  // A failed fetch (offline, server hiccup) is NOT the same as "no such
  // landmark" -- it gets its own Try again state instead of a dead end.
  const [customError, setCustomError] = useState(null);
  const [customAttempt, setCustomAttempt] = useState(0);

  useEffect(() => {
    if (staticLandmark) {
      setCustomLoading(false);
      return;
    }
    let cancelled = false;
    setCustomLoading(true);
    setCustomError(null);
    getCustomLandmark(id)
      .then((l) => {
        if (cancelled) return;
        setCustomLandmark(l);
        setCustomLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setCustomError(e);
        setCustomLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, staticLandmark, customAttempt]);

  // Memoized so it's referentially stable across renders once resolved --
  // several effects below key off "landmark changed" (e.g. the one-shot map
  // focus point on first open), which would misfire on every render otherwise
  // since the custom-landmark branch would build a brand-new object each time.
  const landmark = useMemo(
    () =>
      (staticLandmark && applyEdit(staticLandmark)) ||
      (customLandmark && {
        ...customLandmark,
        regionId: customLandmark.region,
        categories: customLandmark.categories || [],
        images: customLandmark.images || [],
        facts: customLandmark.facts || [],
        free: customLandmark.free ?? true,
        typicalMinutes: customLandmark.typicalMinutes ?? 15,
      }),
    [staticLandmark, customLandmark, applyEdit]
  );
  const { ratings, reload: reloadRatings } = useRatings();
  const { reload: reloadMyPhotos } = useMyPhotos();
  const { myUsername, friendUids } = useFriends();
  const toast = useToast();
  // myRating: live RatingFlow payload (null until a tier's picked).
  // savedRating: what's already on file, to pre-fill on an edit.
  const [myRating, setMyRating] = useState(null);
  const [savedRating, setSavedRating] = useState(null);
  // Your own check-in doc here (for "Checked in: Tuesday, Sep 15 at 3:47 PM").
  const [myCheckin, setMyCheckin] = useState(null);
  const [visitCount, setVisitCount] = useState(0);
  // Admin Mode: editing this check-in's date/time, same as editing the
  // landmark's own fields above.
  const [editingCheckinDate, setEditingCheckinDate] = useState(false);
  const [checkinDateValue, setCheckinDateValue] = useState('');
  const [checkinDateSaving, setCheckinDateSaving] = useState(false);
  const [checkinDateError, setCheckinDateError] = useState('');
  const [myPhotos, setMyPhotos] = useState([]);
  // "My Photos" panel -- your own check-in gallery, addable/removable
  // anytime after checking in, independent of the star rating below.
  const [checkinPhotoBusy, setCheckinPhotoBusy] = useState(false);
  const [checkinPhotoError, setCheckinPhotoError] = useState(null);
  // The photo whose upload just failed, kept so Try again doesn't make you
  // pick it all over again.
  const [failedCheckinPhoto, setFailedCheckinPhoto] = useState(null);
  const [photoFiles, setPhotoFiles] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [saveError, setSaveError] = useState(null);
  // True right after a successful save: the button itself reads "Rating
  // submitted!" until the user changes something in the flow again.
  const [submitted, setSubmitted] = useState(false);
  // Whether that save was an edit of an existing rating vs. a first-time
  // one -- captured at save time since savedRating itself flips true
  // immediately after ANY save, first-time included.
  const [justEdited, setJustEdited] = useState(false);
  const [reviews, setReviews] = useState([]);
  // Your own comment on this place (with or without a rating), for the
  // editor at the top of Comments. null until loaded.
  const [myComment, setMyComment] = useState(null);
  // You left a rating or comment here (possibly via Rate a Landmark, with
  // no check-in) -- that's yours to edit too.
  const [hasMyReview, setHasMyReview] = useState(false);
  // Bumped when the comment is edited on its own, so the rating flow below
  // remounts with it instead of later saving its older copy back.
  const [commentRev, setCommentRev] = useState(0);
  // 'loading' only for the first fetch (skeleton); later refreshes after a
  // save/delete happen quietly behind the list that's already showing.
  const [reviewsStatus, setReviewsStatus] = useState('loading'); // loading | ready | error
  const [reviewsError, setReviewsError] = useState(null);
  const [reportedNow, setReportedNow] = useState(() => new Set());
  const [blockedNow, setBlockedNow] = useState(() => new Set());
  const [landmarkReported, setLandmarkReported] = useState(false);
  const [factsExpanded, setFactsExpanded] = useState(false);
  const [shareMsg, setShareMsg] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');

  // Questions go to Mapr (the app's one assistant): it opens the chat with
  // this landmark named and asks there.
  const askAI = (e, preset) => {
    e?.preventDefault?.();
    const q = (preset ?? aiQuestion).trim();
    if (!q) return;
    navigate('/mapr', { state: { ask: `About ${landmark.name}${region?.name ? ` in ${region.name}` : ''}: ${q}` } });
  };

  // Remember which city this landmark belongs to, so tapping Back returns to
  // that city's list (not whatever the popularity sort floats to the top).
  useEffect(() => {
    if (regionId) {
      updateTrip({ activeRegion: regionId });
      setMapFocus(regionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId]);

  // Open every landmark at the TOP (its photo), not wherever the previous page
  // was scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector('.app-main')?.scrollTo?.(0, 0);
  }, [id]);

  // After viewing a landmark, the map should open zoomed right onto IT (via the
  // Map tab or the "See it on the Map" button) so you can see exactly where you
  // are, then pinch out. One-shot: the map consumes and clears it.
  useEffect(() => {
    if (landmark) setMapFocusPoint({ lat: landmark.lat, lng: landmark.lng, name: landmark.name, regionId, id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, landmark]);

  const loadMyReview = useCallback(async () => {
    if (!firebaseEnabled || !user || !landmark) return;
    // Best-effort pre-fill: if this read fails the card still works, it
    // just starts blank (and saving overwrites correctly either way).
    const r = await getMyReview(user.uid, landmark.id).catch(() => null);
    setMyComment(r?.comment || '');
    setHasMyReview(!!r);
    if (!r) return;
    // Pre-fills the tier flow on an edit. A legacy star-only review (from
    // before there was only ever the tier flow) has no tier to pre-fill --
    // .stars is kept here only so "Your rating" below has something to
    // show, not to feed back into the (now tier-only) rating flow.
    setSavedRating(
      r.ratingTier
        ? {
            tier: r.ratingTier,
            highlights: r.highlights || [],
            lovedOrder: r.lovedOrder || [],
            dislikedOrder: r.dislikedOrder || [],
            comment: r.comment || '',
          }
        : r.stars
        ? { stars: r.stars, comment: r.comment || '' }
        : null
    );
    setMyPhotos(r.photoURLs?.length ? r.photoURLs : r.photoURL ? [r.photoURL] : []);
  }, [firebaseEnabled, user, landmark]);

  useEffect(() => {
    loadMyReview();
  }, [loadMyReview]);

  const checkedInHere = !!(landmark && claimedMap[landmark.id]);
  useEffect(() => {
    if (!firebaseEnabled || !user || !landmark || !checkedInHere) {
      setMyCheckin(null);
      setVisitCount(0);
      return;
    }
    let cancelled = false;
    getVisitCount(user.uid, landmark.id)
      .then((n) => {
        if (!cancelled) setVisitCount(n);
      })
      .catch(() => {});
    getMyCheckin(user.uid, landmark.id)
      .then((c) => {
        if (cancelled) return;
        setMyCheckin(c);
        // Prepended ahead of whatever's already here (review photos), so a
        // photo you added after checking in stays the landmark's lead photo
        // even on a fresh page load, not just right after adding it.
        const checkinPhotos = checkinPhotosNewestFirst(c);
        if (checkinPhotos.length) {
          setMyPhotos((prev) => {
            const fresh = checkinPhotos.filter((u) => !prev.includes(u));
            return fresh.length ? [...fresh, ...prev] : prev;
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [firebaseEnabled, user, landmark, checkedInHere]);

  // quiet: a refresh after your own save/delete keeps the current list on
  // screen (and a failure there leaves it as-is) rather than flashing a
  // skeleton or an error over reviews that are already showing.
  const loadReviews = useCallback(
    async ({ quiet = false } = {}) => {
      if (!firebaseEnabled || !landmark) return;
      if (!quiet) {
        setReviewsStatus('loading');
        setReviewsError(null);
      }
      try {
        const list = await getLandmarkReviews(landmark.id, { uid: user?.uid, friendUids });
        // Lists can't check blocks server-side (see firestore.rules), so
        // people you've blocked are dropped here.
        const blocked = user ? await listBlockedUsers(user.uid).catch(() => []) : [];
        const blockedIds = new Set(blocked.map((b) => b.blockedUid));
        setReviews(list.filter((r) => !blockedIds.has(r.userId)));
        setReviewsStatus('ready');
      } catch (e) {
        if (quiet) return;
        setReviewsError(e);
        setReviewsStatus('error');
      }
    },
    // friendUids by value, so a fresh-but-identical array doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firebaseEnabled, landmark, user?.uid, [...friendUids].join(',')]
  );

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  if (!landmark && customLoading) {
    return <LandmarkDetailSkeleton />;
  }

  if (!landmark && customError) {
    return (
      <div className="empty-state">
        <ErrorNotice
          error={customError}
          message={friendlyError(customError, "We couldn't load this landmark. Try again.")}
          onRetry={() => setCustomAttempt((n) => n + 1)}
        />
        <button className="btn btn-ghost" onClick={() => navigate('/landmarks')}>
          Back to List
        </button>
      </div>
    );
  }

  if (!region || !landmark) {
    return (
      <div className="empty-state landmark-not-found">
        <p className="landmark-not-found-icon" aria-hidden="true">
          {'\u{1F9ED}'}
        </p>
        <h2 style={{ margin: '0 0 6px' }}>We couldn't find that landmark</h2>
        <p className="screen-subtitle" style={{ marginTop: 0 }}>
          It may have been removed, or the link is out of date.
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/landmarks')}>
          Back to List
        </button>
      </div>
    );
  }

  const isSelected = getRegionSelection(regionId).includes(landmark.id);
  const agg = ratings[landmark.id];
  const draftKey = ratingDraftKey(user?.uid, landmark.id);

  const onPhotoChange = async () => {
    const f = await pickPhoto();
    if (f) {
      setPhotoFiles((prev) => (prev.length < 3 ? [...prev, f] : prev));
      setPhotoPreviews((prev) => (prev.length < 3 ? [...prev, URL.createObjectURL(f)] : prev));
    }
  };
  const removePhoto = (i) => {
    setPhotoFiles((prev) => prev.filter((_, idx) => idx !== i));
    setPhotoPreviews((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmitReview = async () => {
    if (!myRating) {
      setSaveMsg('Pick one of the three first.');
      return;
    }
    // Captured before the save (and its loadMyReview reload below, which
    // would otherwise make savedRating true either way) so the button can
    // still tell "submitted" from "updated" after this specific save.
    const wasEdit = !!savedRating;
    setSaving(true);
    setSaveMsg(null);
    setSaveError(null);
    let res;
    try {
      res = await submitReview({
        userId: user.uid,
        userName: myUsername || user.displayName || 'Explorer',
        landmark,
        rating: myRating,
        photoFiles,
      });
    } catch (e) {
      // Your tier/chips/comment and photos all stay put -- Try again
      // resubmits exactly what's on screen.
      setSaveError(e);
      setSaving(false);
      return;
    }
    clearPersisted(draftKey);
    setPhotoFiles([]);
    setPhotoPreviews([]);
    setJustEdited(wasEdit);
    setSubmitted(true);
    setSaveMsg(res?.photoFailed ? "Rating saved — but your photo couldn't upload." : null);
    setSaving(false);
    // The rating is saved; these only refresh what's shown, so a hiccup
    // here must never read as "your rating failed".
    Promise.all([reloadRatings(), loadReviews({ quiet: true }), loadMyReview(), reloadMyPhotos()]).catch(() => {});
  };

  // Optimistic: your review disappears the moment you tap Delete; if the
  // server says no, it's put back with a Retry.
  const handleDeleteMine = () => {
    const before = { reviews, savedRating, myPhotos };
    runOptimistic({
      apply: () => {
        setReviews((cur) => cur.filter((r) => r.userId !== user.uid));
        setSavedRating(null);
        setMyRating(null);
        // The review's own photos are gone, but any check-in gallery photos
        // (added independently via "My Photos" below) aren't touched by this.
        setMyPhotos(checkinPhotosNewestFirst(myCheckin));
      },
      commit: async () => {
        await deleteMyReview(user.uid, landmark.id);
        Promise.all([reloadRatings(), loadReviews({ quiet: true }), reloadMyPhotos()]).catch(() => {});
      },
      rollback: () => {
        setReviews(before.reviews);
        setSavedRating(before.savedRating);
        setMyPhotos(before.myPhotos);
      },
      toast,
      errorMessage: "Couldn't delete your review, so we put it back.",
      retry: handleDeleteMine,
    });
  };

  const startEditCheckinDate = () => {
    setCheckinDateValue(toZonedInputValue(myCheckin?.createdAt?.seconds, regionTimezone(regionId, landmark?.lng)));
    setCheckinDateError('');
    setEditingCheckinDate(true);
  };
  const cancelEditCheckinDate = () => {
    setEditingCheckinDate(false);
    setCheckinDateError('');
  };
  const saveCheckinDate = async () => {
    if (!checkinDateValue) return;
    // The picker holds the landmark's OWN local wall-clock time, not the
    // admin's device time.
    const date = fromZonedInputValue(checkinDateValue, regionTimezone(regionId, landmark?.lng));
    if (Number.isNaN(date.getTime())) {
      setCheckinDateError('Invalid date/time.');
      return;
    }
    setCheckinDateSaving(true);
    setCheckinDateError('');
    try {
      await updateCheckinTimestamp(`${user.uid}_${landmark.id}`, date);
      setMyCheckin((cur) => ({ ...cur, createdAt: { seconds: Math.floor(date.getTime() / 1000) } }));
      setEditingCheckinDate(false);
    } catch (e) {
      setCheckinDateError(friendlyError(e, 'Could not save — try again.'));
    } finally {
      setCheckinDateSaving(false);
    }
  };

  const checkinPhotos = myCheckin?.photoURLs || (myCheckin?.photoURL ? [myCheckin.photoURL] : []);

  const uploadCheckinPhoto = async (f) => {
    setCheckinPhotoBusy(true);
    setCheckinPhotoError(null);
    setFailedCheckinPhoto(null);
    try {
      const url = await addCheckinPhoto(user.uid, landmark.id, f);
      setMyCheckin((prev) => ({ ...prev, photoURLs: [...(prev?.photoURLs || []), url] }));
      setMyPhotos((prev) => (prev.includes(url) ? prev : [url, ...prev]));
      reloadMyPhotos().catch(() => {});
    } catch (e) {
      setCheckinPhotoError(friendlyError(e, "Couldn't upload that photo. Try again."));
      setFailedCheckinPhoto(f);
    } finally {
      setCheckinPhotoBusy(false);
    }
  };

  const addMyCheckinPhoto = async () => {
    if (checkinPhotos.length >= MAX_CHECKIN_PHOTOS) return;
    const f = await pickPhoto();
    if (f) uploadCheckinPhoto(f);
  };

  // Optimistic: the photo vanishes right away; put back (with Retry) if
  // the server refuses.
  const removeMyCheckinPhoto = (url) => {
    const before = { myCheckin, myPhotos };
    setCheckinPhotoError(null);
    runOptimistic({
      apply: () => {
        setMyCheckin((prev) => ({
          ...prev,
          photoURLs: (prev?.photoURLs || []).filter((u) => u !== url),
          photoURL: prev?.photoURL === url ? null : prev?.photoURL,
        }));
        setMyPhotos((prev) => prev.filter((u) => u !== url));
        if (lightboxSrc === url) setLightboxSrc(null);
      },
      commit: async () => {
        await removeCheckinPhoto(user.uid, landmark.id, url);
        reloadMyPhotos().catch(() => {});
      },
      rollback: () => {
        setMyCheckin(before.myCheckin);
        setMyPhotos(before.myPhotos);
      },
      toast,
      errorMessage: "Couldn't remove that photo, so we put it back.",
      retry: () => removeMyCheckinPhoto(url),
    });
  };

  // Report / Block / Report-this-landmark all flip to "✓" instantly and
  // undo themselves (with a Retry toast) only if the write fails.
  const handleReport = (rv) =>
    runOptimistic({
      apply: () => setReportedNow((s) => new Set(s).add(rv.id)),
      commit: async () => {
        await reportReview({ reporterUid: user.uid, review: rv });
        loadReviews({ quiet: true });
      },
      rollback: () =>
        setReportedNow((s) => {
          const next = new Set(s);
          next.delete(rv.id);
          return next;
        }),
      toast,
      errorMessage: "Couldn't send that report. Nothing was changed.",
      retry: () => handleReport(rv),
    });

  const handleBlock = (rv) =>
    runOptimistic({
      apply: () => setBlockedNow((s) => new Set(s).add(rv.userId)),
      commit: async () => {
        await blockUser(user.uid, rv.userId, rv.userName);
        loadReviews({ quiet: true });
      },
      rollback: () =>
        setBlockedNow((s) => {
          const next = new Set(s);
          next.delete(rv.userId);
          return next;
        }),
      toast,
      errorMessage: `Couldn't block ${rv.userName || 'that person'}. Nothing was changed.`,
      retry: () => handleBlock(rv),
    });

  const handleReportLandmark = () => {
    if (!customLandmark || !user) return;
    runOptimistic({
      apply: () => setLandmarkReported(true),
      commit: () => reportCustomLandmark(user.uid, customLandmark.docId),
      rollback: () => setLandmarkReported(false),
      toast,
      errorMessage: "Couldn't send that report. Nothing was changed.",
      retry: handleReportLandmark,
    });
  };

  const shareVisit = async () => {
    const checkedIn = !!claimedMap[landmark.id];
    const url = `${window.location.origin}/#/landmarks/${regionId}/${landmark.id}`;
    const text = checkedIn
      ? `\u{1F3AF} I just checked in at ${landmark.name} on Landmark Hunters — come explore and try to beat my score! \u{1F3C6}`
      : `\u{1F4CD} Check out ${landmark.name} on Landmark Hunters — hunt landmarks, check in, and earn points!`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Landmark Hunters', text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setShareMsg('Link copied — paste it to your friends! \u{1F4E3}');
        setTimeout(() => setShareMsg(null), 4000);
      }
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  };

  // Add or edit your own comment any time after checking in here.
  const myCommentBox =
    user && myComment !== null && (checkedInHere || hasMyReview || reviews.some((r) => r.userId === user.uid)) ? (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="review-head" style={{ marginBottom: 6 }}>
          <strong>Your comment</strong>
        </div>
        <MyCommentEditor
          userId={user.uid}
          landmark={{ ...landmark, region: landmark.region ?? regionId }}
          comment={myComment}
          onSaved={(text) => {
            setMyComment(text);
            setCommentRev((n) => n + 1);
            Promise.all([loadReviews({ quiet: true }), loadMyReview()]).catch(() => {});
          }}
        />
      </div>
    ) : null;

  return (
    <div>
      <div className="detail-topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
          {'← Back'}
        </button>
        {checkinNav && (
          <div className="checkin-stepper">
            <button
              type="button"
              className="btn btn-ghost btn-sm checkin-stepper-btn"
              onClick={() => stepCheckin(-1)}
              disabled={!navPrev}
              aria-label={navPrev ? `Previous check-in: ${navPrev.name}` : 'No previous check-in'}
              title={navPrev?.name || ''}
            >
              {'\u{2039}'}
            </button>
            <span className="checkin-stepper-count">
              {checkinNav.index + 1} / {checkinNav.sequence.length}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm checkin-stepper-btn"
              onClick={() => stepCheckin(1)}
              disabled={!navNext}
              aria-label={navNext ? `Next check-in: ${navNext.name}` : 'No next check-in'}
              title={navNext?.name || ''}
            >
              {'\u{203A}'}
            </button>
          </div>
        )}
      </div>

      <LandmarkPostcard landmark={landmark} size="lg" swipeable myPhotos={myPhotos} onImageClick={setLightboxSrc} />

      <h1 className="screen-title" style={{ justifyContent: 'center', textAlign: 'center' }}>
        {landmark.name}
      </h1>

      <div className="center" style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        {landmark.categories.map((c) => (
          <span key={c} className="tag">
            {CATEGORY_LABEL[c]}
          </span>
        ))}
        <span className={`tag ${landmark.free ? 'tag-free' : ''}`}>{landmark.free ? 'Free to Visit' : 'Ticketed'}</span>
        <span className="tag">{'~' + landmark.typicalMinutes + ' min'}</span>
        {customLandmark && <span className="tag">{'\u{2728}'} Community-submitted</span>}
      </div>
      {customLandmark && user && customLandmark.createdBy !== user.uid && (
        <p className="center" style={{ marginTop: -10, marginBottom: 18 }}>
          {landmarkReported ? (
            <span className="review-reported">Reported ✓</span>
          ) : (
            <button className="btn btn-ghost btn-tight" onClick={handleReportLandmark}>
              Report this landmark
            </button>
          )}
        </p>
      )}

      {customLandmark && adminMode && isAdmin(user?.email) && (
        <AdminEditLandmarkPanel
          landmark={customLandmark}
          onSaved={(fields) => setCustomLandmark((cur) => ({ ...cur, ...fields }))}
        />
      )}

      {staticLandmark && adminMode && isAdmin(user?.email) && (
        <AdminEditBuiltInPanel landmark={landmark} onSaved={reloadLandmarkEdits} />
      )}

      <div className="center" style={{ marginBottom: 18 }}>
        <RatingStars value={agg?.avg || 0} count={agg?.count || 0} size="1.15rem" />
      </div>

      <div className="card section">
        <p style={{ fontSize: '1.02rem', margin: 0 }}>{landmark.summary}</p>
      </div>

      {landmark.tip && (
        <div
          className="card section"
          style={{
            borderLeft: '4px solid #f5a623',
            background: 'rgba(245, 166, 35, 0.10)',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: '1.2rem', lineHeight: 1.3 }}>{'⚠️'}</span>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            <strong>Good to know:</strong> {landmark.tip}
          </p>
        </div>
      )}

      {landmark.facts.length > 0 && (
      <div className="section">
        <h3>Quick Facts</h3>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          {(factsExpanded ? landmark.facts : landmark.facts.slice(0, FACTS_PREVIEW)).map((f, i) => (
            <li key={i} style={{ marginBottom: 8, lineHeight: 1.5 }}>
              {f}
            </li>
          ))}
        </ul>
        {landmark.facts.length > FACTS_PREVIEW && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setFactsExpanded((v) => !v)}
            style={{ marginTop: 10 }}
          >
            {factsExpanded
              ? 'Show less'
              : `Show ${landmark.facts.length - FACTS_PREVIEW} more`}
          </button>
        )}
      </div>
      )}

      {firebaseEnabled && user && (
        <div className="card checkin-stats-card">
          <h3 style={{ marginTop: 0 }}>{'\u{1F4CD}'} Your Check-in Stats</h3>
          {!checkedInHere ? (
            <p className="screen-subtitle" style={{ margin: 0 }}>
              You haven't checked in yet. Check in to see your stats.
            </p>
          ) : (
            <ul className="checkin-stats">
              {visitCount > 1 && (
                <li>
                  <span>Visits:</span> {visitCount}
                </li>
              )}
              <li>
                <span>Checked in:</span>{' '}
                {myCheckin?.createdAt?.seconds ? (
                  fmtCheckinTime(myCheckin.createdAt.seconds)
                ) : (
                  <Skeleton width={150} height={12} style={{ display: 'inline-block', verticalAlign: 'middle' }} />
                )}
                {adminMode && isAdmin(user?.email) && !editingCheckinDate && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginLeft: 8, padding: '1px 6px', fontSize: '0.7rem' }}
                    onClick={startEditCheckinDate}
                  >
                    {'\u{270F}\u{FE0F}'} Edit
                  </button>
                )}
                {editingCheckinDate && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
                    <input
                      type="datetime-local"
                      name="checkin-time"
                      aria-label="Check-in date and time"
                      value={checkinDateValue}
                      onChange={(e) => setCheckinDateValue(e.target.value)}
                      disabled={checkinDateSaving}
                      style={{ fontSize: '0.78rem', padding: '4px 6px' }}
                    />
                    <span className="tag" style={{ fontSize: '0.68rem' }}>
                      {tzAbbrev(regionTimezone(regionId, landmark?.lng))} — {getRegion(regionId)?.name || regionId}
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={checkinDateSaving}
                      onClick={saveCheckinDate}
                    >
                      {checkinDateSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={checkinDateSaving}
                      onClick={cancelEditCheckinDate}
                    >
                      Cancel
                    </button>
                    {checkinDateError && (
                      <span className="tag tag-error" style={{ fontSize: '0.7rem' }}>
                        {checkinDateError}
                      </span>
                    )}
                  </div>
                )}
              </li>
              <li>
                <span>Your rating:</span>{' '}
                {savedRating?.tier
                  ? `${tierById(savedRating.tier)?.emoji || ''} ${tierById(savedRating.tier)?.label || ''}`
                  : savedRating?.stars
                  ? 'Rated (before Mapr’s current rating system)'
                  : 'Not rated yet'}
              </li>
            </ul>
          )}
        </div>
      )}

      <DirectionsButton
        name={landmark.name}
        lat={landmark.lat}
        lng={landmark.lng}
        className="btn btn-ghost btn-block"
        style={{ marginBottom: 12 }}
      >
        {'\u{1F9ED}'} Get Directions
      </DirectionsButton>

      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginBottom: 12 }}
        onClick={() => {
          setMapFocusPoint({ lat: landmark.lat, lng: landmark.lng, name: landmark.name, regionId, id });
          navigate('/');
        }}
      >
        {'\u{1F5FA}\u{FE0F}'} See it on the Map
      </button>

      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginBottom: aiOpen ? 10 : 12 }}
        onClick={() => setAiOpen((o) => !o)}
      >
        {'✨'} Ask Mapr about {landmark.name}
      </button>

      {aiOpen && (
        <div className="card section ai-box" style={{ marginBottom: 12 }}>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            Ask anything — history, tips, what to see or eat, best time to go. Mapr answers in its chat.
          </p>
          <div className="ai-chips">
            {['Give me a quick overview', 'Best time to visit?', 'What should I not miss?', 'Where should I eat nearby?'].map(
              (chip) => (
                <button key={chip} type="button" className="tag ai-chip" onClick={(e) => askAI(e, chip)}>
                  {chip}
                </button>
              )
            )}
          </div>
          <form onSubmit={askAI} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              type="text"
              name="question"
              aria-label={`Ask about ${landmark.name}`}
              autoComplete="off"
              enterKeyHint="send"
              placeholder={`Ask about ${landmark.name}…`}
              value={aiQuestion}
              maxLength={500}
              onChange={(e) => setAiQuestion(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary btn-sm" type="submit" disabled={!aiQuestion.trim()}>
              Ask Mapr
            </button>
          </form>

          <p className="ai-disclaimer">AI can be wrong — double-check hours &amp; prices before you go.</p>
        </div>
      )}

      <button
        type="button"
        className={`btn btn-block ${isSelected ? 'btn-success' : 'btn-primary'}`}
        onClick={() => toggleLandmark(landmark.id, regionId)}
        style={{ marginBottom: 12 }}
      >
        {isSelected ? '✓ Added to Itinerary' : 'Add to Itinerary'}
      </button>

      <CheckInButton
        landmark={landmark}
        user={user}
        firebaseEnabled={firebaseEnabled}
        claimedMap={claimedMap}
        checkingIn={checkingIn}
        onCheckIn={checkIn}
        className="btn-block"
      />

      <button type="button" className="btn btn-primary btn-block" onClick={shareVisit} style={{ marginTop: 12 }}>
        {'\u{1F3C6}'} Share with Friends & Family
      </button>
      {shareMsg && (
        <p className="screen-subtitle" style={{ textAlign: 'center', marginTop: 6, marginBottom: 0 }}>
          {shareMsg}
        </p>
      )}

      {firebaseEnabled && user && checkedInHere && (
        <div className="card section" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{'\u{1F4F8}'} My Photos</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            Your own photos of this spot — add more anytime, remove any you don't want.
          </p>
          {checkinPhotos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {checkinPhotos.map((url) => (
                <div key={url} style={{ position: 'relative' }}>
                  <img
                    src={url}
                    alt="Your photo"
                    onClick={() => setLightboxSrc(url)}
                    style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, display: 'block', cursor: 'pointer' }}
                  />
                  <button
                    type="button"
                    onClick={() => removeMyCheckinPhoto(url)}
                    disabled={checkinPhotoBusy}
                    aria-label="Remove photo"
                    style={{
                      position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%',
                      border: 'none', background: 'rgba(0,0,0,0.78)', color: '#fff', cursor: 'pointer', lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {checkinPhotos.length < MAX_CHECKIN_PHOTOS && (
            <div style={{ marginTop: checkinPhotos.length > 0 ? 12 : 0 }}>
              <button type="button" className="btn btn-ghost btn-sm" disabled={checkinPhotoBusy} onClick={addMyCheckinPhoto}>
                {checkinPhotoBusy ? 'Working…' : `${'\u{1F4F8}'} Add photo (${checkinPhotos.length}/${MAX_CHECKIN_PHOTOS})`}
              </button>
            </div>
          )}
          {checkinPhotoError && (
            <ErrorNotice
              compact
              message={checkinPhotoError}
              onRetry={failedCheckinPhoto ? () => uploadCheckinPhoto(failedCheckinPhoto) : undefined}
            />
          )}
        </div>
      )}

      {firebaseEnabled && isRateable(landmark) && (
        <div className="card section" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Rate your visit</h3>
          {!user ? (
            <p className="screen-subtitle" style={{ margin: 0 }}>Sign in to rate this place.</p>
          ) : !claimedMap[landmark.id] ? (
            <p className="screen-subtitle" style={{ margin: 0 }}>
              Check in here first to rate it and add a photo.
            </p>
          ) : (
            <>
              {savedRating && (
                <p className="screen-subtitle" style={{ marginTop: 0 }}>
                  {'\u{2713}'} Already rated — change anything below to update it.
                </p>
              )}
              <p className="screen-subtitle" style={{ marginTop: 0, marginBottom: 12 }}>
                Rate for yourself, not others. This is just so we learn your taste.
              </p>
              <RatingFlow
                key={`${landmark.id}:${commentRev}`}
                landmark={landmark}
                initial={savedRating?.tier ? savedRating : null}
                draftKey={draftKey}
                onChange={(r) => {
                  setMyRating(r);
                  setSubmitted(false);
                  setSaveError(null);
                }}
              />
              {photoPreviews.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {photoPreviews.map((src, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img
                        src={src}
                        alt={`Photo ${i + 1}`}
                        style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, display: 'block' }}
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        aria-label="Remove photo"
                        style={{
                          position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%',
                          border: 'none', background: 'rgba(0,0,0,0.78)', color: '#fff', cursor: 'pointer', lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {photoFiles.length < 3 && (
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onPhotoChange}>
                    {'\u{1F4F8}'} Add photo ({photoFiles.length}/3)
                  </button>
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary btn-block"
                style={{ marginTop: 12 }}
                disabled={saving || submitted || !myRating}
                onClick={handleSubmitReview}
              >
                {saving
                  ? 'Saving…'
                  : submitted
                  ? `\u{2713} Rating ${justEdited ? 'updated' : 'submitted'}!`
                  : savedRating
                  ? 'Update Rating'
                  : 'Submit Rating'}
              </button>
              {saveMsg && (
                <p className="screen-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
                  {saveMsg}
                </p>
              )}
              {saveError && (
                <ErrorNotice
                  compact
                  message={friendlyError(saveError, "Couldn't save your rating. Your picks are still here — try again.")}
                  onRetry={handleSubmitReview}
                />
              )}
            </>
          )}
        </div>
      )}

      {firebaseEnabled && reviewsStatus === 'loading' && (
        <div className="section">
          <h3>{'\u{1F4AC}'} Comments</h3>
          <SkeletonList count={2} label="Loading reviews" />
        </div>
      )}

      {firebaseEnabled && reviewsStatus === 'error' && (
        <div className="section">
          <h3>{'\u{1F4AC}'} Comments</h3>
          <ErrorNotice
            message={friendlyError(reviewsError, "Couldn't load reviews right now.")}
            onRetry={() => loadReviews()}
          />
        </div>
      )}

      {firebaseEnabled && reviewsStatus === 'ready' && reviews.length === 0 && (isRateable(landmark) || checkedInHere) && (
        <div className="section">
          <h3>{'\u{1F4AC}'} Comments</h3>
          {myCommentBox}
          <p className="screen-subtitle" style={{ margin: 0 }}>
            No comments yet.
          </p>
        </div>
      )}

      {firebaseEnabled && reviewsStatus === 'ready' && reviews.length > 0 && (
        <div className="section">
          <h3>{'\u{1F4AC}'} Comments ({reviews.length})</h3>
          {myCommentBox}
          {reviews.map((r) => {
            const mine = user && r.userId === user.uid;
            // Yours is already in the "Your comment" box above.
            if (mine && myCommentBox) return null;
            return (
              <div key={r.id} className="review-item">
                <div className="review-head">
                  <strong>{r.userName}</strong>
                  {r.ratingTier ? (
                    <span className="tag">
                      {tierById(r.ratingTier)?.emoji} {tierById(r.ratingTier)?.label}
                    </span>
                  ) : null}
                </div>
                {r.comment && !(mine && myCommentBox) && <p className="review-comment">{r.comment}</p>}
                {(() => {
                  // firestore.rules already filtered this list down to reviews
                  // this viewer is allowed to see in full (their own, a
                  // friend's, or a public account's) -- so any photo here is
                  // safe to show, no separate client-side gate needed.
                  const photos = r.photoURLs?.length ? r.photoURLs : r.photoURL ? [r.photoURL] : [];
                  if (!photos.length) return null;
                  return (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {photos.map((u, i) => (
                        <img
                          key={i}
                          src={u}
                          alt={`${r.userName}'s visit ${i + 1}`}
                          className="review-photo"
                          style={{ cursor: 'zoom-in', maxWidth: photos.length > 1 ? '31%' : '100%' }}
                          onClick={() => setLightboxSrc(u)}
                        />
                      ))}
                    </div>
                  );
                })()}
                {user && (
                  <div className="review-actions">
                    {mine ? (
                      <button className="btn btn-ghost btn-tight" onClick={handleDeleteMine}>
                        Delete
                      </button>
                    ) : blockedNow.has(r.userId) ? (
                      <span className="review-reported">Blocked ✓</span>
                    ) : (
                      <>
                        {reportedNow.has(r.id) || r.reportedBy?.includes(user.uid) ? (
                          <span className="review-reported">Reported ✓</span>
                        ) : (
                          <button className="btn btn-ghost btn-tight" onClick={() => handleReport(r)}>
                            Report
                          </button>
                        )}
                        <button className="btn btn-ghost btn-tight" onClick={() => handleBlock(r)}>
                          Block
                        </button>
                      </>
                    )}
                  </div>
                )}
                <ReviewReplies reviewId={r.id} currentUser={user} reviewAuthorUid={r.userId} />
              </div>
            );
          })}
        </div>
      )}

      <Lightbox src={lightboxSrc} alt="Visit photo" onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
