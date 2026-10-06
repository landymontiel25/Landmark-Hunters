import { useMemo, useState } from 'react';
import { ALL_LANDMARKS, getRegion } from '../data/regions';
import { searchScore } from '../lib/search';
import { friendlyError } from '../lib/friendlyError';
import { saveOnboardingPlaces } from '../lib/onboardingSave';

const MAX_PLACES = 10;

// Profile step: "Tell us up to 10 places you visit most". Typing a name pops
// up matching places from the catalog; Tab or Enter takes the top match and
// tapping any row adds that one.
//
// Given a `uid` (the real sign-up), Continue also saves the places to the
// account, and Mapr reads them from that save on every surface. Without one
// (the Test tab) nothing is saved.
export default function OnboardingPlaces({ places, onChange, onDone, uid = null, profile = null }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [term, setTerm] = useState('');
  const q = term.trim();
  const full = places.length >= MAX_PLACES;
  const suggestions = useMemo(() => {
    if (!q) return [];
    const taken = new Set(places.map((l) => `${l.regionId}/${l.id}`));
    return ALL_LANDMARKS.filter((l) => !taken.has(`${l.regionId}/${l.id}`))
      .map((l) => ({ l, score: searchScore(l.name, getRegion(l.regionId)?.name || '', q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.l.name.localeCompare(b.l.name))
      .slice(0, 6)
      .map((x) => x.l);
  }, [q, places]);
  const top = suggestions[0];

  const next = async () => {
    if (uid && (places.length || profile?.onboardingPlaces?.length)) {
      setSaving(true);
      setSaveError('');
      try {
        await saveOnboardingPlaces(uid, profile, places);
      } catch (e) {
        setSaveError(friendlyError(e, "Couldn't save your places. Try again."));
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    onDone();
  };

  const add = (l) => {
    if (full) return;
    onChange([...places, l], `Added place: ${l.name}`);
    setTerm('');
  };
  const remove = (l) => onChange(places.filter((p) => p !== l), `Removed place: ${l.name}`);
  const onKeyDown = (e) => {
    if ((e.key === 'Tab' || e.key === 'Enter') && top && !full) {
      e.preventDefault();
      add(top);
    }
  };
  // Greyed-out rest of the top match's name, so Tab visibly completes it.
  const ghost = top && top.name.toLowerCase().startsWith(term.toLowerCase()) ? top.name.slice(term.length) : '';

  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F4CD}'}</span> Your places
      </h1>
      <p className="screen-subtitle">Tell us up to 10 places you visit most, and we'll help you discover new spots you'll love.</p>
      <p className="screen-subtitle">Mapr gets smarter with every rating you give. Rate for you, and your next picks improve.</p>
      <div className="field lab-place-search">
        <label htmlFor="lab-place">
          Place {places.length} of {MAX_PLACES}
        </label>
        <div className="lab-place-input">
          {ghost && (
            <span className="lab-place-ghost" aria-hidden="true">
              <span style={{ visibility: 'hidden' }}>{term}</span>
              {ghost}
            </span>
          )}
          <input
            id="lab-place"
            type="search"
            autoComplete="off"
            placeholder={full ? 'That is 10, nice' : 'Start typing a place name'}
            disabled={full}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {suggestions.length > 0 && (
          <ul className="lab-log lab-place-suggestions" role="listbox">
            {suggestions.map((l) => (
              <li key={`${l.regionId}/${l.id}`}>
                <button type="button" role="option" aria-selected={l === top} className="btn btn-ghost btn-block" onClick={() => add(l)}>
                  {l.name} <span className="screen-subtitle">{getRegion(l.regionId)?.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q && suggestions.length === 0 && !full && <p className="screen-subtitle">No place matches “{q}”.</p>}
      </div>
      {places.length > 0 && (
        <ol className="lab-log lab-place-list">
          {places.map((l) => (
            <li key={`${l.regionId}/${l.id}`}>
              {l.name}{' '}
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${l.name}`} onClick={() => remove(l)}>
                {'\u{2715}'}
              </button>
            </li>
          ))}
        </ol>
      )}
      {saveError && (
        <p className="tag tag-error" role="alert" style={{ display: 'block', marginTop: 12 }}>
          {saveError}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={saving} onClick={next}>
        {saving ? 'Saving…' : places.length ? 'Continue' : 'Skip for now'} {'\u{2192}'}
      </button>
    </div>
  );
}
