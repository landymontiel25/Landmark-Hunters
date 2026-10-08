import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTrip } from '../lib/TripContext';
import { usePersistentState } from '../lib/usePersistentState';
import { friendlyError } from '../lib/friendlyError';
import ErrorNotice from '../components/ErrorNotice';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { useGpsStartLocation } from '../lib/useGpsStartLocation';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { PICKABLE_INTERESTS, getRegion } from '../data/regions';
import { nearestRegionId } from '../lib/geo';
import { classifyInterest } from '../lib/interestClassifier';
import { listFriends } from '../lib/friends';
import { matchesSearch } from '../lib/search';
import { createGroupTrip, MAX_GROUP_MEMBERS } from '../lib/groupTrips';
import LocationAutocomplete, { HomeStartPrefill } from '../components/LocationAutocomplete';
import AddInterestChip from '../components/AddInterestChip';
import RegionSearch from '../components/RegionSearch';
import PreferenceChips from '../components/PreferenceChips';

const isEmptyList = (v) => !v?.length;

// Friend multi-select shown once "Group" is picked as the trip type -- lets
// you invite friends to the group trip right at creation instead of adding
// them one at a time after, from GroupTrip's own member list.
function GroupFriendPicker({ friends, loading, error, onRetry, query, onQueryChange, selected, onToggle }) {
  const q = query.trim();
  const filtered = q ? friends.filter((f) => matchesSearch(f.friendName, q)) : friends;

  return (
    <div className="card section" style={{ marginTop: 10 }}>
      <p className="screen-subtitle" style={{ marginTop: 0 }}>
        Add friends to build this trip together — everyone added can see and edit the shared landmark list.
      </p>
      {/* A failed load isn't "no friends yet" -- say so and offer a retry. */}
      {loading ? (
        <SkeletonList count={3} label="Loading your friends" />
      ) : error ? (
        <ErrorNotice error={error} message={friendlyError(error, "Couldn't load your friends. Try again.")} onRetry={onRetry} compact />
      ) : friends.length === 0 ? (
        <p className="screen-subtitle" style={{ marginBottom: 0 }}>
          No friends yet — add some from your <Link to="/profile">Profile</Link> first.
        </p>
      ) : (
        <>
          <input
            type="search"
            name="friend-search"
            aria-label="Search friends"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Search friends…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          {selected.size >= MAX_GROUP_MEMBERS - 1 && (
            <p className="screen-subtitle">A group trip fits up to {MAX_GROUP_MEMBERS} people, including you, so that's everyone you can add.</p>
          )}
          {filtered.length === 0 && <p className="screen-subtitle">No friends match "{query}".</p>}
          {filtered.map((f) => (
            <label key={f.friend} className="friend-row" style={{ cursor: 'pointer' }}>
              <span>{f.friendName || 'A traveler'}</span>
              <input
                type="checkbox"
                checked={selected.has(f.friend)}
                disabled={!selected.has(f.friend) && selected.size >= MAX_GROUP_MEMBERS - 1}
                onChange={() => onToggle(f.friend)}
                style={{ width: 20, height: 20 }}
              />
            </label>
          ))}
        </>
      )}
    </div>
  );
}

// No longer its own bottom-nav tab -- opened as the "Create New Trip" modal
// from Itinerary instead. Unchanged otherwise: still a full region/interests/
// trip-type form, its own lazy chunk, navigating away (Map, Choose Landmarks,
// a new group trip) closes the modal the same way leaving any route would.
export default function TripSetup() {
  const { trip, updateTrip, setCustomInterestMatches, setCustomInterestEmoji, removeCustomInterest, applyPreferences } =
    useTrip();
  const { useCurrentLocation, locating, locateError, usingGps } = useGpsStartLocation();
  const { user } = useAuth();
  const { myUsername } = useFriends();
  const navigate = useNavigate();
  // Custom interests (e.g. "nightlife", "racing") aren't tagged on any landmark,
  // so the AI has to figure out which ones fit while this stays showing "finding
  // matches…" on the chip. Not persisted -- it's re-derived from the trip's own
  // pending state (a custom interest with no matches entry yet).
  const [classifying, setClassifying] = useState(() => new Set());
  // Whether "Use My Preferences" is toggled on -- an explicit on/off flag
  // rather than something derived from comparing trip.interests to
  // savedInterests, since those can coincidentally match (or drift apart
  // after you tweak a chip by hand) without you ever touching this control.
  const [preferencesSelected, setPreferencesSelected] = useState(false);
  // Trip type is a required, explicit choice -- starts at null (neither
  // picked) rather than defaulting to 'solo', so Setup can't be continued
  // without deciding. Previously the only way into a group trip was way at
  // the end of the solo flow (Itinerary's "Start a Group Trip" button,
  // after building your own landmark list); this makes it a choice up
  // front instead.
  // Saved with the rest of the half-built trip (region, start and
  // interests already persist in TripContext), so closing the modal or the
  // app mid-setup doesn't lose the Solo/Group pick or the friends ticked.
  const draftKey = user ? `tripsetup.${user.uid}` : null;
  const [tripMode, setTripMode] = usePersistentState(draftKey && `${draftKey}.mode`, null); // null | 'solo' | 'group'
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState(null);
  const [friendQuery, setFriendQuery] = useState('');
  const [selectedFriendList, setSelectedFriendList] = usePersistentState(draftKey && `${draftKey}.friends`, [], {
    isEmpty: isEmptyList,
  });
  const selectedFriendUids = new Set(selectedFriendList);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState(null);

  const loadFriends = () => {
    if (!user) return;
    setFriendsLoading(true);
    setFriendsError(null);
    listFriends(user.uid)
      .then(setFriends)
      .catch(setFriendsError)
      .finally(() => setFriendsLoading(false));
  };
  useEffect(() => {
    loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const toggleFriendSelected = (uid) => {
    setSelectedFriendList((cur) => (cur.includes(uid) ? cur.filter((u) => u !== uid) : [...cur, uid]));
  };


  const toggleInterest = (id) => {
    const has = trip.interests.includes(id);
    updateTrip({
      interests: has ? trip.interests.filter((i) => i !== id) : [...trip.interests, id],
    });
  };

  const addCustomInterest = (text) => {
    if (trip.customInterests.includes(text)) return;
    updateTrip({ customInterests: [...trip.customInterests, text] });
    setClassifying((cur) => new Set(cur).add(text));
    classifyInterest(text).then(({ matches, emoji, failed }) => {
      if (!failed) {
        setCustomInterestMatches(text, matches);
        setCustomInterestEmoji(text, emoji);
      }
      setClassifying((cur) => {
        const next = new Set(cur);
        next.delete(text);
        return next;
      });
    });
  };

  const selectRegion = (region) => {
    if (region.id === trip.activeRegion) return;
    updateTrip({ activeRegion: region.id, startingLocation: '', startingCoords: null });
  };

  const activeRegion = getRegion(trip.activeRegion) || { name: '' };

  // A region and an explicit Solo/Group choice are both required; Group
  // additionally requires being signed in, since the trip needs an owner.
  const canContinue = !!trip.activeRegion && !!tripMode && (tripMode === 'solo' || !!user);

  const startGroupTrip = async () => {
    if (!user || !trip.activeRegion) return;
    setCreatingGroup(true);
    setGroupError(null);
    try {
      const id = await createGroupTrip({
        ownerUid: user.uid,
        ownerName: myUsername || user.displayName || 'Explorer',
        name: `${activeRegion.name} Trip`,
        regionId: trip.activeRegion,
        initialMembers: friends
          .filter((f) => selectedFriendUids.has(f.friend))
          .map((f) => ({ uid: f.friend, name: f.friendName })),
      });
      // Submitted: the saved Solo/Group pick and friend ticks are done with.
      setTripMode(null);
      setSelectedFriendList([]);
      navigate(`/group/${id}`);
    } catch (e) {
      // Everything picked stays as it was, ready for Try again.
      setGroupError(e);
    } finally {
      setCreatingGroup(false);
    }
  };

  const togglePreferences = () => {
    if (preferencesSelected) {
      updateTrip({ interests: [], customInterests: [] });
    } else {
      applyPreferences();
    }
    setPreferencesSelected((s) => !s);
  };

  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F9ED}'}</span> Plan Your Trip
      </h1>
      <p className="screen-subtitle">Tell us where you're starting and what you're into — we'll build the route.</p>

      <button type="button" className="btn btn-ghost btn-block" style={{ marginBottom: 24 }} onClick={() => navigate('/')}>
        {'\u{1F310}'} Just Browse the Map First
      </button>

      <div className="field">
        <label htmlFor="start">
          Starting Location <span style={{ fontWeight: 400, color: 'var(--color-parchment-dim)' }}>(optional)</span>
        </label>
        <button
          type="button"
          className={`btn btn-sm ${usingGps ? 'btn-primary' : 'btn-ghost'}`}
          style={{ marginBottom: 10 }}
          onClick={useCurrentLocation}
          disabled={locating}
        >
          {'\u{1F4CD}'} {locating ? 'Locating…' : usingGps ? 'Using Your Current Location' : 'Use My Current Location'}
        </button>
        <LocationAutocomplete
          name="start-location"
          id="start"
          placeholder="Or type an address, hotel, etc."
          value={trip.startingLocation}
          onChange={(text) => updateTrip({ startingLocation: text, startingCoords: null })}
          onSelect={(s) =>
            updateTrip({
              startingLocation: s.primary,
              startingCoords: { lat: s.lat, lng: s.lng },
              activeRegion: nearestRegionId(s.lat, s.lng),
            })
          }
        />
        {locateError && (
          <p className="tag tag-error" style={{ marginTop: 6 }}>
            {locateError}
          </p>
        )}
        <HomeStartPrefill />
        {!trip.startingLocation && (
          <p style={{ fontSize: '0.78rem', color: 'var(--color-parchment-dim)', marginTop: 6 }}>
            No starting point set — the itinerary will route from wherever you are.
          </p>
        )}
      </div>

      <div className="field">
        <label>Region</label>
        <RegionSearch region={activeRegion} onSelect={selectRegion} placeholder="Search for a region…" />
      </div>

      <div className="field">
        <label>What are you interested in?</label>
        {(trip.savedInterests.length > 0 || trip.savedCustomInterests.length > 0) && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <button
              type="button"
              className={`chip ${preferencesSelected ? 'selected' : ''}`} aria-pressed={!!(preferencesSelected)}
              onClick={togglePreferences}
            >
              <span className="chip-icon">{'⭐'}</span>
              <span>Use My Preferences</span>
            </button>
          </div>
        )}
        <div className="chip-grid">
          {PICKABLE_INTERESTS.map((i) => (
            <button
              key={i.id}
              type="button"
              className={`chip ${trip.interests.includes(i.id) ? 'selected' : ''}`} aria-pressed={!!(trip.interests.includes(i.id))}
              onClick={() => toggleInterest(i.id)}
            >
              <span className="chip-icon">{i.icon}</span>
              <span>{i.label}</span>
            </button>
          ))}
          {trip.customInterests.map((text) => (
            <div
              key={text}
              className="chip selected"
              style={{ cursor: 'default' }}
               aria-busy={classifying.has(text)}
            title={classifying.has(text) ? 'Finding matching landmarks…' : undefined}
            >
              <span className="chip-icon">
                {classifying.has(text) ? (
                  <Skeleton width={16} height={16} radius={16} />
                ) : (
                  trip.customInterestEmoji[text] || '\u{2728}'
                )}
              </span>
              <span>{text}</span>
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove ${text}`}
                onClick={() => removeCustomInterest(text)}
              >
                {'\u{1F5D1}\u{FE0F}'}
              </button>
            </div>
          ))}
          <AddInterestChip existing={trip.customInterests} onAdd={addCustomInterest} />
        </div>
      </div>

      <div className="card section">
        <h3 style={{ marginTop: 0 }}>{'⭐'} My Preferences</h3>
        <p className="screen-subtitle" style={{ marginTop: -6 }}>
          Save what you're usually into once, and "Use My Preferences" above fills it in with one tap on every trip.
        </p>
        <PreferenceChips />
      </div>

      <div className="field">
        <label>Trip Type</label>
        <div className="tabs" style={{ justifyContent: 'center' }}>
          <button type="button" className={`tab-btn ${tripMode === 'solo' ? 'active' : ''}`} aria-pressed={!!(tripMode === 'solo')} onClick={() => setTripMode('solo')}>
            {'\u{1F464}'} Solo
          </button>
          <button type="button" className={`tab-btn ${tripMode === 'group' ? 'active' : ''}`} aria-pressed={!!(tripMode === 'group')} onClick={() => setTripMode('group')}>
            {'\u{1F465}'} Group
          </button>
        </div>
        {tripMode === null && (
          <p style={{ fontSize: '0.78rem', color: 'var(--color-parchment-dim)', marginTop: 6 }}>
            Choose one to continue.
          </p>
        )}
        {tripMode === 'group' && !user && (
          <p className="screen-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
            <Link to="/profile">Sign in</Link> to start a group trip.
          </p>
        )}
        {tripMode === 'group' && user && (
          <GroupFriendPicker
            friends={friends}
            loading={friendsLoading}
            error={friendsError}
            onRetry={loadFriends}
            query={friendQuery}
            onQueryChange={setFriendQuery}
            selected={selectedFriendUids}
            onToggle={toggleFriendSelected}
          />
        )}
      </div>

      {groupError && !creatingGroup && (
        <ErrorNotice
          message={friendlyError(groupError, "Couldn't start the group trip. Try again.")}
          onRetry={startGroupTrip}
          compact
        />
      )}
      <button
        type="button"
        className="btn btn-primary btn-block"
        // Ticked friends are only sent once the friends list has loaded;
        // starting before that would make the trip without them.
        disabled={!canContinue || creatingGroup || (tripMode === 'group' && friendsLoading && selectedFriendList.length > 0)}
        onClick={
          tripMode === 'group'
            ? startGroupTrip
            : () => {
                setTripMode(null);
                navigate('/landmarks');
              }
        }
      >
        {tripMode === 'group'
          ? creatingGroup
            ? 'Starting…'
            : `${'\u{1F465}'} Start Group Trip ${'\u{2192}'}`
          : `Choose Landmarks ${'\u{2192}'}`}
      </button>
    </div>
  );
}
