import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { REGIONS, getRegion } from '../data/regions';
import CategorySelect from '../components/CategorySelect';
import { nearestRegionId, nearestAttributableRegionId } from '../lib/geo';
import { useGeo } from '../lib/GeoContext';
import { useCheckIn } from '../lib/useCheckIn';
import { distanceMeters, CHECKIN_RADIUS_METERS } from '../lib/leaderboard';
import { useAuth } from '../lib/AuthContext';
import { authErrorMessage } from '../lib/authErrors';
import { auth } from '../lib/firebase';
import { useTrip } from '../lib/TripContext';
import { addCustomLandmark, uploadLandmarkPhoto } from '../lib/customLandmarks';
import { findPossibleDuplicate } from '../lib/duplicateLandmarkCheck';
import { fileToSmallDataUrl, pickPhoto } from '../lib/imageUtils';
import LocationAutocomplete from '../components/LocationAutocomplete';
import ErrorNotice from '../components/ErrorNotice';
import { friendlyError, fetchJson } from '../lib/friendlyError';
import { readPersisted, writePersisted, clearPersisted } from '../lib/usePersistentState';
import { API_BASE } from '../lib/apiBase';

// Our own plain-language messages (and the AI's "reason"), which
// friendlyError should show as written rather than swap for a generic one.
function userError(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

const draftKeyFor = (uid) => (uid ? `addLandmark.${uid}` : null);

const draftHasContent = (d) => !!(d && (d.name || d.addressText || d.categories?.length || d.facts?.length || d.factDraft));

const SAT_TILE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
};

const LABELS_TILE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Place labels &copy; Esri',
};

const DRAG_PIN_ICON = L.divIcon({
  className: '',
  html: '<div class="map-pin-wrap"><div class="map-pin map-pin-focus"></div></div>',
  iconSize: [26, 30],
  iconAnchor: [13, 28],
});

// Every field's label states up front whether it's required to submit --
// Location, Name, and Topic are; Facts and Photo are optional.
function FieldLabel({ children, required }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span>{children}</span>
      <span className={`tag ${required ? '' : 'tag-optional'}`}>{required ? 'Required' : 'Optional'}</span>
    </label>
  );
}

// Keeps the mini-map centered on wherever the pin currently is -- otherwise
// tapping "Use My Exact Location" would move the pin but leave the map
// looking at the old spot.
function RecenterOnPosition({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView([position.lat, position.lng], map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.lat, position?.lng]);
  return null;
}

// A brand-new landmark, start to finish: name, at least one topic, and its
// exact spot -- either your current GPS location or an actual pin you drag
// into place on a small map (much more obvious than tapping somewhere on
// the full explore map used to be). A photo is optional but speeds up the
// AI moderation check. The AI verification + Firestore/Storage save is
// identical to what the old inline "Add Pin" panel on the map used to do.
export default function AddLandmark() {
  const navigate = useNavigate();
  const location = useLocation();
  const { coords } = useGeo();
  const { user, firebaseEnabled, checkIn } = useCheckIn();
  const { resendVerification } = useAuth();
  const { trip } = useTrip();

  // The map screen's "+" button passes along the exact spot you were
  // looking at (a dropped pin, or just the map's current center) so this
  // starts there instead of jumping to your GPS location.
  const startingCenter = () => {
    if (location.state?.lat != null && location.state?.lng != null) {
      return { lat: location.state.lat, lng: location.state.lng };
    }
    if (coords) return { lat: coords.lat, lng: coords.lng };
    const region = trip.activeRegion && getRegion(trip.activeRegion);
    return region?.center || REGIONS[0].center;
  };

  // Everything typed here (not the photo -- files can't be stored) is kept
  // on this device as you go, so leaving mid-way and coming back picks up
  // where you were. A spot handed over from the map's "+" is a fresh,
  // deliberate choice, so it wins over a saved pin position.
  const draftKey = draftKeyFor(user?.uid);
  const [savedDraft] = useState(() => (draftKey && readPersisted(draftKey)) || null);
  const fromMap = location.state?.lat != null && location.state?.lng != null;
  // True once the pin was placed on purpose (dragged, searched, "Use My
  // Location", or handed over from the map) -- a late GPS fix then never
  // yanks it somewhere else.
  const pinChosenRef = useRef(fromMap || !!savedDraft?.position);

  const [position, setPosition] = useState(() =>
    !fromMap && savedDraft?.position ? savedDraft.position : startingCenter()
  );
  const [addressText, setAddressText] = useState(() => savedDraft?.addressText || '');
  const [name, setName] = useState(() => savedDraft?.name || '');
  const [categories, setCategories] = useState(() => savedDraft?.categories || []);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [facts, setFacts] = useState(() => savedDraft?.facts || []);
  const [factDraft, setFactDraft] = useState(() => savedDraft?.factDraft || '');
  const [stage, setStage] = useState('idle'); // idle | verifying | saving
  const [error, setError] = useState(null);
  const busy = stage !== 'idle';
  const submittingRef = useRef(false);
  const [draftRestored, setDraftRestored] = useState(() => draftHasContent(savedDraft));

  const choosePosition = (pos) => {
    pinChosenRef.current = true;
    setPosition(pos);
  };

  // GPS often lands a moment after this screen opens -- if the pin is still
  // sitting on the region/default fallback, move it to where you actually
  // are (once; later GPS ticks never drag it around).
  const gpsAppliedRef = useRef(!!coords);
  useEffect(() => {
    if (!coords || gpsAppliedRef.current) return;
    gpsAppliedRef.current = true;
    if (!pinChosenRef.current) setPosition({ lat: coords.lat, lng: coords.lng });
  }, [coords]);

  // Signed-in state can arrive just after this screen mounts (cold open
  // straight to Add Landmark) -- pick up the draft then, unless you've
  // already started typing.
  const loadedKeyRef = useRef(draftKey);
  useEffect(() => {
    if (!draftKey || loadedKeyRef.current === draftKey) return;
    loadedKeyRef.current = draftKey;
    const d = readPersisted(draftKey);
    if (!draftHasContent(d) || name || addressText || categories.length || facts.length || factDraft) return;
    setName(d.name || '');
    setAddressText(d.addressText || '');
    setCategories(d.categories || []);
    setFacts(d.facts || []);
    setFactDraft(d.factDraft || '');
    if (d.position && !fromMap && !pinChosenRef.current) choosePosition(d.position);
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return undefined;
    const t = setTimeout(() => {
      const draft = { name, addressText, categories, facts, factDraft };
      if (!draftHasContent(draft)) {
        clearPersisted(draftKey);
        return;
      }
      // Only a pin you placed yourself is worth restoring; the default
      // center is recomputed fresh (e.g. from GPS) each time anyway.
      writePersisted(draftKey, { ...draft, position: pinChosenRef.current ? position : null });
    }, 300);
    return () => clearTimeout(t);
  }, [draftKey, name, addressText, categories, facts, factDraft, position]);

  const discardDraft = () => {
    clearPersisted(draftKey);
    setName('');
    setAddressText('');
    setCategories([]);
    setFacts([]);
    setFactDraft('');
    if (!fromMap) {
      pinChosenRef.current = false;
      setPosition(startingCenter());
    }
    setError(null);
    setDraftRestored(false);
  };

  const regionId = nearestRegionId(position.lat, position.lng);

  // Catches "I'm re-adding something that's already on the map" before the
  // AI/moderation round trip, not after -- checked against both the
  // built-in catalog and anyone else's submissions in the same region as
  // the current pin. Runs off whatever's typed in either Name or the
  // address search (people often type a business name into the address
  // box, same as searching for an address does) -- whichever one
  // currently has text. Only ever says something when it finds a match --
  // it used to also show a green "doesn't look like an existing landmark"
  // tag on no match, which just confused people into thinking a real spot
  // couldn't be added when the name-matching missed it or false-flagged it.
  const [duplicateMatch, setDuplicateMatch] = useState(null);
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [duplicateOverridden, setDuplicateOverridden] = useState(false);
  // Set only when the match came from directly picking an existing
  // landmark out of LocationAutocomplete's own suggestions (not a
  // typed-name guess) -- a certain duplicate, not a maybe, so there's no
  // legitimate "this is a different place" to offer. Cleared the moment
  // Name or the address box is typed into again (see their onChange below),
  // not by this effect -- selecting a suggestion also moves the pin, which
  // changes regionId and would otherwise re-run this effect and immediately
  // undo the confirmation.
  const [confirmedLandmarkId, setConfirmedLandmarkId] = useState(null);
  const duplicateConfirmed = !!confirmedLandmarkId && duplicateMatch?.id === confirmedLandmarkId;
  useEffect(() => {
    setDuplicateOverridden(false);
    const query = name.trim() || addressText.trim();
    if (query.length < 2) {
      setDuplicateMatch(null);
      setDuplicateChecking(false);
      return;
    }
    let cancelled = false;
    setDuplicateChecking(true);
    const handle = setTimeout(async () => {
      const match = await findPossibleDuplicate({ name: query, regionId }).catch(() => null);
      if (!cancelled) {
        setDuplicateMatch(match);
        setDuplicateChecking(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [name, addressText, regionId]);

  const removeFact = (i) => setFacts((cur) => cur.filter((_, idx) => idx !== i));

  const addFact = () => {
    const value = factDraft.trim();
    if (!value) return;
    setFacts((cur) => [...cur, value]);
    setFactDraft('');
  };

  const onPhotoChange = async () => {
    const f = await pickPhoto();
    if (!f) return;
    setPhoto(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  // Address (the pin) is the only real requirement -- Name and Category are
  // optional (auto-filled below if left blank), and a typed-name duplicate
  // guess is informational only, never blocking (it can be a false
  // positive). A confirmed duplicate (picked an existing landmark by name
  // from the suggestions) is different -- that can't be a false positive,
  // so it does block submission until View It is used or the pick changes.
  const canSubmit = position && user && !duplicateConfirmed;

  const submit = async () => {
    // A ref, not `busy`: two fast taps can both run before React re-renders
    // with stage !== 'idle', which saved the landmark twice.
    if (!canSubmit || busy || submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    try {
      setStage('verifying');
      const imageDataUrl = photo ? await fileToSmallDataUrl(photo) : '';
      // Forced refresh: right after verifying their email, a cached token
      // still says unverified for up to an hour, and firestore.rules checks
      // the token's email_verified before accepting the new landmark.
      const idToken = await (auth.currentUser || user).getIdToken(true);
      // Capped like the Name box: a long address as the fallback name would
      // exceed the 120-char rule in firestore.rules (permission-denied).
      const finalName = (name.trim() || addressText.trim() || 'New Landmark').slice(0, 80);
      let verified;
      try {
        verified = await fetchJson(`${API_BASE}/api/verify-landmark`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          // Never leave "Verifying…" spinning forever on a stalled request.
          signal: AbortSignal.timeout(90000),
          body: JSON.stringify({
            name: finalName,
            categories,
            lat: position.lat,
            lng: position.lng,
            imageDataUrl,
            userFacts: facts,
          }),
        });
      } catch (e) {
        if (e.code !== 'email-not-verified') throw e;
        verified = { code: e.code };
      }
      if (verified?.code === 'email-not-verified') {
        // The original link is probably buried in an inbox from whenever they
        // signed up -- easier to try firing off a fresh one than ask them to
        // go dig for it. Firebase rate-limits repeat sends, though, and
        // resending on every failed attempt hits that limit fast -- so this
        // must only claim a new email went out when one actually did, or
        // someone stuck in this loop (rate-limited on every retry) keeps
        // getting told to check for a "fresh" link that was never sent.
        let resent = false;
        let resendErr = null;
        try {
          await resendVerification();
          resent = true;
        } catch (e) {
          // Surface the real reason instead of a silent swallow -- "it just
          // doesn't work" with no error code is undiagnosable. A specific
          // reason (rate-limited, network, etc.) is something we can act on.
          resendErr = e;
        }
        throw userError(
          resent
            ? "Verify your email first — we just sent a fresh link to your inbox (check spam too), then try again."
            : `Verify your email first — check your inbox for the verification link we already sent you (check spam too), then try again. (Couldn't send another one: ${authErrorMessage(resendErr)})`
        );
      }
      if (!verified.ok) throw userError(verified.reason || "That doesn't look like a real place — try a different name or add a photo.");

      setStage('saving');
      // Unlike the search-biasing regionId above, this is permanent -- if
      // nothing curated is actually nearby, leave it unattributed (shows as
      // "Custom pin") rather than filing it under the wrong city/country.
      const region = nearestAttributableRegionId(position.lat, position.lng);
      const tempId = `pending-${Date.now()}`;
      const imageUrl = photo ? await uploadLandmarkPhoto(tempId, user.uid, photo) : null;
      // If no name was typed (finalName is just the address text), or what
      // was typed is a shorthand of the real place's full name ("Tapia" for
      // "Tapia Peruvian Restaurant" -- the typed name is a prefix/substring
      // of it), save it under the AI's research instead -- but never
      // override a name that's actually a different name, since that could
      // be a deliberate choice, not a shorthand.
      const typedName = name.trim();
      const resolved = verified.resolvedName || '';
      const isShorthand = typedName && resolved.toLowerCase().includes(typedName.toLowerCase());
      const savedName = resolved && (!typedName || isShorthand) ? resolved : finalName;
      const created = await addCustomLandmark({
        region,
        name: savedName,
        lat: position.lat,
        lng: position.lng,
        userId: user.uid,
        // Category and photo are yours if you picked one -- the AI only
        // fills the gap when you left it blank, the same way it already
        // does for facts/summary.
        categories: categories.length ? categories : verified.category ? [verified.category] : [],
        images: imageUrl ? [imageUrl] : verified.imageUrl ? [verified.imageUrl] : [],
        summary: verified.summary,
        facts: verified.facts,
        free: verified.free,
        typicalMinutes: verified.typicalMinutes || undefined,
        topic: verified.topic || null,
        hours: verified.hours || null,
      });
      // Submitted -- the saved draft has done its job.
      clearPersisted(draftKey);
      // Standing right where you added it (within the same radius a normal
      // Check In button requires) means you don't have to tap Check In
      // separately -- open the same rate + post prompt every other check-in
      // path uses. Too far (or no GPS fix), and nothing happens here: you
      // check in manually later, once you're actually there.
      if (created.region && coords && distanceMeters(coords.lat, coords.lng, position.lat, position.lng) <= CHECKIN_RADIUS_METERS) {
        checkIn({ id: created.id, name: savedName, region: created.region, lat: position.lat, lng: position.lng });
      }
      navigate(`/landmarks/${created.region}/${created.id}`);
    } catch (err) {
      // Everything you entered (photo included) stays on the form.
      setError(err);
      setStage('idle');
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
        {'← Back'}
      </button>

      <h1 className="screen-title">
        <span>{'\u{2795}'}</span> Add Landmark
      </h1>
      <p className="screen-subtitle">
        Add a real place that's missing from the map. It goes live right away — we'll research it and fill in whatever
        you leave blank (category, photo, facts, and more).
      </p>
      {draftRestored && (
        <p className="draft-restored-note">
          {'\u{1F4DD}'} Picked up where you left off {'\u{00B7}'}{' '}
          <button type="button" onClick={discardDraft}>
            Discard
          </button>
        </p>
      )}

      <div className="field">
        <FieldLabel required>Location</FieldLabel>
        <p style={{ fontSize: '0.78rem', color: 'var(--color-parchment-dim)', marginTop: -4, marginBottom: 10 }}>
          Drag the pin to the exact spot, use your current location, or search an address.
        </p>
        <div className="itinerary-map" style={{ height: 260 }}>
          <MapContainer center={[position.lat, position.lng]} zoom={17} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
            <TileLayer url={SAT_TILE.url} attribution={SAT_TILE.attribution} />
            <TileLayer url={LABELS_TILE.url} attribution={LABELS_TILE.attribution} zIndex={650} />
            <RecenterOnPosition position={position} />
            <Marker
              position={[position.lat, position.lng]}
              icon={DRAG_PIN_ICON}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const { lat, lng } = e.target.getLatLng();
                  choosePosition({ lat, lng });
                  setAddressText('');
                },
              }}
            />
          </MapContainer>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-block"
          style={{ marginTop: 10 }}
          disabled={!coords}
          onClick={() => {
            choosePosition({ lat: coords.lat, lng: coords.lng });
            setAddressText('');
          }}
        >
          {'\u{1F4CD}'} {coords ? 'Use My Exact Location' : 'Locating…'}
        </button>
        <div style={{ marginTop: 10 }}>
          <LocationAutocomplete
            placeholder="Or search an address…"
            value={addressText}
            regionId={regionId}
            onChange={(v) => {
              setAddressText(v);
              setConfirmedLandmarkId(null);
            }}
            onSelect={(s) => {
              // Move the pin, but leave the typed address text alone --
              // the geocoder's top match is sometimes the nearest known
              // business at that address, not the address itself, and
              // overwriting what was typed with that name is confusing.
              choosePosition({ lat: s.lat, lng: s.lng });
              // Picking one of the "landmark" suggestions (not a plain
              // address) means they chose an EXISTING landmark by name --
              // a certain duplicate, not the usual typed-name guess.
              setConfirmedLandmarkId(s.landmarkId || null);
              if (s.landmarkId) setDuplicateMatch({ name: s.primary, region: s.landmarkRegionId, id: s.landmarkId });
            }}
          />
        </div>
        {/* Checked off whichever of Name/address currently has text --
            typing a business name here (like searching an address does) is
            common enough that the duplicate check needs to catch it here
            too, not just in the Name field below. */}
        {duplicateChecking && (
          <p className="screen-subtitle" style={{ marginTop: 6, marginBottom: 0, fontSize: '0.78rem' }}>
            Checking if this is already a landmark…
          </p>
        )}
        {!duplicateChecking && duplicateMatch && !duplicateOverridden && (
          <div className="card" style={{ marginTop: 8, padding: '10px 12px' }}>
            <p className="tag tag-error" style={{ display: 'block', margin: 0 }}>
              {'\u{2B50}'} This is already a landmark: {duplicateMatch.name}
            </p>
            {duplicateConfirmed && (
              <p className="screen-subtitle" style={{ margin: '6px 0 0' }}>
                You picked this one from the suggestions, so it can't be a different place -- view it instead of
                adding a duplicate.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigate(`/landmarks/${duplicateMatch.region}/${duplicateMatch.id}`)}
              >
                View it
              </button>
              {/* Only offered for a typed-name GUESS (namesMatch is fuzzy and
                  can false-positive) -- not when the user directly picked an
                  existing landmark from the suggestions above, which can't
                  be a false positive. */}
              {!duplicateConfirmed && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDuplicateOverridden(true)}>
                  This is a different place — continue
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="field">
        <FieldLabel>Name</FieldLabel>
        <p style={{ fontSize: '0.78rem', color: 'var(--color-parchment-dim)', marginTop: -4, marginBottom: 10 }}>
          Leave blank and we'll use the address.
        </p>
        {/* autoComplete off: it's a place's name, and browsers would
            otherwise offer the user's own name/contacts here. */}
        <input
          type="text"
          name="landmark-name"
          aria-label="Landmark name"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="next"
          placeholder="e.g. Farley Hall"
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            setConfirmedLandmarkId(null);
          }}
        />
      </div>

      <div className="field">
        <FieldLabel>Category</FieldLabel>
        <p style={{ fontSize: '0.78rem', color: 'var(--color-parchment-dim)', marginTop: -4, marginBottom: 10 }}>
          Leave blank and we'll research it and pick one.
        </p>
        <CategorySelect value={categories[0] || ''} onSelect={(id) => setCategories([id])} />
      </div>

      <div className="field">
        <FieldLabel>Facts</FieldLabel>
        <p style={{ fontSize: '0.78rem', color: 'var(--color-parchment-dim)', marginTop: -4, marginBottom: 10 }}>
          Know something true about it? Add a few — we won't make anything up ourselves.
        </p>
        {facts.map((f, i) => (
          <div
            key={i}
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 6 }}
          >
            <span style={{ flex: 1 }}>{f}</span>
            <button type="button" className="btn btn-ghost btn-tight" onClick={() => removeFact(i)} aria-label="Remove fact">
              ✕
            </button>
          </div>
        ))}
        {facts.length < 5 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              name="fact"
              aria-label="Add a fact"
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="done"
              placeholder="e.g. Built by the class of 1998"
              value={factDraft}
              maxLength={160}
              onChange={(e) => setFactDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addFact();
                }
              }}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!factDraft.trim()} onClick={addFact}>
              Add
            </button>
          </div>
        )}
      </div>

      <div className="field">
        <FieldLabel>Photo</FieldLabel>
        <p style={{ fontSize: '0.78rem', color: 'var(--color-parchment-dim)', marginTop: -4, marginBottom: 10 }}>
          Helps others recognize it. Skip it and we'll try to find a real photo of the place ourselves — never a stock
          photo or a guess.
        </p>
        {photoPreview ? (
          <div style={{ position: 'relative', width: 120 }}>
            <img
              src={photoPreview}
              alt="Preview"
              style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 12, display: 'block' }}
            />
            <button
              type="button"
              onClick={() => {
                setPhoto(null);
                setPhotoPreview(null);
              }}
              aria-label="Remove photo"
              style={{
                position: 'absolute', top: -8, right: -8, width: 26, height: 26, borderRadius: '50%',
                border: 'none', background: 'rgba(0,0,0,0.78)', color: '#fff', cursor: 'pointer', lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-block" onClick={onPhotoChange}>
            {'\u{1F4F8}'} Add a photo
          </button>
        )}
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!canSubmit || busy}
        aria-busy={busy}
        onClick={submit}
      >
        {stage === 'verifying' ? 'Verifying…' : stage === 'saving' ? 'Saving…' : 'Add Landmark'}
      </button>

      {!user && (
        <p className="tag tag-error" style={{ display: 'block', marginTop: 10 }}>
          {firebaseEnabled ? 'Sign in first (Profile tab) — adding a landmark needs an account.' : 'Accounts aren’t set up yet.'}
        </p>
      )}
      {error && (
        <ErrorNotice
          message={friendlyError(error, "Couldn't add this landmark. Everything you entered is still here — try again.")}
          onRetry={canSubmit ? submit : undefined}
        />
      )}
    </div>
  );
}
