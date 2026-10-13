import { useEffect, useState } from 'react';
import { getRegion } from '../data/regions';
import { fetchReputationBoard, getReputation } from '../lib/reputationApi';
import { badgeLabel, levelsOf } from '../lib/reputationLabels';

// Your discoverer levels per city and badges (Phase 4), and the "Trusted
// in {city}" board for `region`: people ranked by local reputation, with
// their level. Levels come from what other people do with your tips
// (helpful, saved, went, loved); nobody sees points.
export default function ReputationCard({ uid, region = null }) {
  const [rep, setRep] = useState(undefined);
  const [board, setBoard] = useState(null);
  const [boardFailed, setBoardFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getReputation(uid).then((r) => !cancelled && setRep(r));
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    if (!region) return undefined;
    let cancelled = false;
    setBoard(null);
    setBoardFailed(false);
    fetchReputationBoard(region)
      .then((e) => !cancelled && setBoard(e))
      .catch(() => !cancelled && setBoardFailed(true));
    return () => {
      cancelled = true;
    };
  }, [region]);

  const levels = levelsOf(rep);
  const badges = (rep?.badges || []).map(badgeLabel).filter(Boolean);
  const city = region ? getRegion(region)?.name || region : null;
  return (
    <div className="card section">
      <h3 style={{ marginTop: 0 }}>{'\u{1F9ED}'} Discoverer</h3>
      {rep === undefined ? null : levels.length ? (
        <p style={{ margin: '0 0 6px' }}>{levels.map((l) => l.label).join(' · ')}</p>
      ) : (
        <p className="muted" style={{ margin: '0 0 6px', fontSize: 14 }}>
          Share tips after verified visits. When people find them helpful, save them and go, you become Local, then Trusted, in that city.
        </p>
      )}
      {badges.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {badges.map((b) => (
            <span key={b.text} className="tip-tag" style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: 'var(--surface-2, #f1f1f1)' }}>
              {b.icon} {b.text}
            </span>
          ))}
        </div>
      )}
      {city && (
        <>
          <h4 style={{ margin: '10px 0 6px' }}>Trusted in {city}</h4>
          {boardFailed && <p className="muted" style={{ fontSize: 13 }}>Couldn't load the board.</p>}
          {board?.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>No discoverers here yet. Share a tip to be the first.</p>}
          {board?.length > 0 && (
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {board.slice(0, 10).map((e) => (
                <li key={e.uid} style={{ padding: '2px 0' }}>
                  {e.uid === uid ? <strong>You</strong> : `@${e.name}`}
                  {e.level ? <span className="muted"> · {e.level}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
