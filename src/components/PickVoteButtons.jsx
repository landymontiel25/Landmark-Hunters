// The three answer buttons on every Mapr pick card: Not for me, Not sure,
// I'd go (the same buttons, labels and emoji as the Travel Picks carousel on
// Profile, which now renders this too). The selected one is the SAVED answer;
// the screen never shows an answer the database does not have yet.
//
//   vote      { verdict, status, tryingVerdict } from usePickVotes (or undefined)
//   onVote    (verdict) => void
//   onRetry   () => void   shown with the error
export const VOTE_COPY = {
  yes: { cls: 'love', emoji: '\u{2713}', label: "I'd go" },
  unsure: { cls: 'unsure', emoji: '\u{1F937}', label: 'Not sure' },
  no: { cls: 'hate', emoji: '\u{2715}', label: 'Not for me' },
};
export const VOTE_ORDER = ['no', 'unsure', 'yes'];

export default function PickVoteButtons({ name = 'this place', vote, onVote, onRetry, className = '' }) {
  const status = vote?.status || 'idle';
  const saved = vote?.verdict || null;
  const busy = status === 'saving';
  return (
    <div className={`pick-vote ${className}`} data-pick-vote>
      <div className="pick-vote-actions" role="group" aria-label={`Would you go to ${name}?`}>
        {VOTE_ORDER.map((verdict) => {
          const copy = VOTE_COPY[verdict];
          const on = saved === verdict;
          return (
            <button
              key={verdict}
              type="button"
              className={`mapr-pick-vote pick-vote-btn ${copy.cls} ${on ? 'on' : ''}`}
              aria-pressed={on}
              aria-label={`${copy.label}: ${name}`}
              disabled={busy}
              onClick={() => onVote?.(verdict)}
            >
              <span aria-hidden="true">{copy.emoji}</span> {copy.label}
            </button>
          );
        })}
      </div>
      {status === 'saving' && (
        <p className="pick-vote-note" role="status">
          Saving…
        </p>
      )}
      {status === 'pending' && (
        <p className="pick-vote-note pending" role="status">
          Not saved yet. It will send when you're back online.
        </p>
      )}
      {status === 'error' && (
        <p className="pick-vote-note error" role="alert">
          Couldn't save your answer.{' '}
          <button type="button" className="pick-vote-retry" onClick={() => onRetry?.()}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
