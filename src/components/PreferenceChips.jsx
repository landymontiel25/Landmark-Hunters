import { useState } from 'react';
import { useTrip } from '../lib/TripContext';
import { PICKABLE_INTERESTS as INTERESTS } from '../data/regions';
import { classifyInterest } from '../lib/interestClassifier';
import AddInterestChip from './AddInterestChip';
import { Skeleton } from './Skeleton';

// The actual chip-grid for saved preferences -- shared by Settings' "My
// Preferences" card, Trip Setup, and the one-time onboarding step right
// after signup, so all three stay in sync with the same trip.saved* fields.
export default function PreferenceChips() {
  const {
    trip,
    toggleSavedInterest,
    addSavedCustomInterest,
    removeSavedCustomInterest,
    toggleSavedCustomInterestSelected,
    setCustomInterestMatches,
    setCustomInterestEmoji,
  } = useTrip();
  const [classifying, setClassifying] = useState(() => new Set());

  const addCustom = (text) => {
    addSavedCustomInterest(text);
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

  return (
    <div className="chip-grid">
      {INTERESTS.map((i) => (
        <button
          key={i.id}
          type="button"
          className={`chip ${trip.savedInterests.includes(i.id) ? 'selected' : ''}`} aria-pressed={!!(trip.savedInterests.includes(i.id))}
          onClick={() => toggleSavedInterest(i.id)}
        >
          <span className="chip-icon">{i.icon}</span>
          <span>{i.label}</span>
        </button>
      ))}
      {trip.savedCustomInterests.map((text) => {
        const isSelected = !trip.deselectedCustomInterests.includes(text);
        return (
          <div
            key={text}
            role="button"
            tabIndex={0}
            className={`chip ${isSelected ? 'selected' : ''}`} aria-pressed={!!(isSelected)}
             aria-busy={classifying.has(text)}
            title={classifying.has(text) ? 'Finding matching landmarks…' : isSelected ? 'Tap to turn off' : 'Tap to turn on'}
            onClick={() => toggleSavedCustomInterestSelected(text)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSavedCustomInterestSelected(text);
              }
            }}
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
              onClick={(e) => {
                e.stopPropagation();
                removeSavedCustomInterest(text);
              }}
            >
              {'\u{1F5D1}\u{FE0F}'}
            </button>
          </div>
        );
      })}
      <AddInterestChip existing={trip.savedCustomInterests} onAdd={addCustom} />
    </div>
  );
}
