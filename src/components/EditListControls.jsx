// Edit List mode on an itinerary (owner, 2026-11-19), like Spotify: a red
// minus on the left takes the stop off THIS itinerary (after the confirm),
// the drag handle on the right reorders it. Nothing else on the stop changes.
export function RemoveStopButton({ name, onClick }) {
  return (
    <button type="button" className="remove-dash stop-remove" aria-label={`Remove ${name} from this itinerary`} title="Remove from this itinerary" onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 12h10" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function DragHandle({ name, onPointerDown, onKeyDown, className = '' }) {
  return (
    <button
      type="button"
      className={`drag-handle ${className}`.trim()}
      title="Hold and drag to reorder"
      aria-label={`Reorder ${name}: hold and drag, or use the up and down arrow keys`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      {'☰'}
    </button>
  );
}
