import { useState } from 'react';

// A shareable "wrapped"-style summary of one city's trip so far: how many
// of the planned stops got visited, and which. No points figure: only an
// account's first check-in ever pays (leaderboard.js), so "visits x 100"
// overstated it, and the real number is almost always 0.
export default function TripRecapCard({ regionName, visitedLandmarks, onClose }) {
  const [shareMsg, setShareMsg] = useState(null);

  const share = async () => {
    const names = visitedLandmarks.map((l) => l.name).join(', ');
    const text =
      `\u{1F9ED} My ${regionName} trip on Landmark Hunters: ${visitedLandmarks.length} landmark` +
      `${visitedLandmarks.length !== 1 ? 's' : ''} visited!` +
      (names ? ` (${names})` : '') +
      ` \u{1F3C6}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Landmark Hunters', text });
      } else {
        await navigator.clipboard.writeText(text);
        setShareMsg('Copied — paste it anywhere!');
        setTimeout(() => setShareMsg(null), 4000);
      }
    } catch (e) {
      // Closing the share sheet isn't a failure; anything else (clipboard
      // blocked, share target crashed) gets a plain note so it isn't silent.
      if (e?.name !== 'AbortError') {
        setShareMsg("Couldn't share that. Try again.");
        setTimeout(() => setShareMsg(null), 4000);
      }
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            border: '2px solid var(--color-brass, #c9a15a)',
            borderRadius: 12,
            padding: 20,
            textAlign: 'center',
            background: 'var(--color-surface-2, rgba(255,255,255,0.04))',
          }}
        >
          <p style={{ margin: 0, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.7 }}>
            Landmark Hunters
          </p>
          <h2 style={{ margin: '6px 0 2px' }}>{regionName}</h2>
          <p style={{ margin: '0 0 16px', opacity: 0.7, fontSize: '0.85rem' }}>Trip Recap</p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 28, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{visitedLandmarks.length}</div>
              <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>landmarks visited</div>
            </div>
          </div>

          {visitedLandmarks.length > 0 && (
            <p style={{ margin: 0, fontSize: '0.82rem', opacity: 0.85 }}>
              {visitedLandmarks.map((l) => l.name).join(' · ')}
            </p>
          )}
        </div>

        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={share}>
          {'\u{1F4E4}'} Share
        </button>
        {shareMsg && (
          <p className="screen-subtitle" style={{ textAlign: 'center', marginTop: 8, marginBottom: 0 }}>
            {shareMsg}
          </p>
        )}
        <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
