import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { OFFLINE_CHECKIN_SYNCED_EVENT } from '../lib/offlineCheckins';
import { missionDone } from '../lib/missions';
import { missionPhotoState } from '../lib/missionPhotoQueue';
import { MISSION_RESULT_EVENT, missionFor, queuedMissionAnswer } from '../lib/missionAnswerQueue';
import MissionPanel from './MissionPanel';
import MissionResult from './MissionResult';

// Missions once an offline check-in syncs (owner, 2026-11-25):
//   - a trivia answer given offline: when the server has checked it, the
//     same result screen as after an online answer (MissionResult): right or
//     wrong and the right answer, until Done;
//   - a check-in synced with its mission not done offline: the mission,
//     ready to do now.
// Like the check-in celebration, these show only while the app is in front,
// one at a time, and are kept on the phone if the app closes first.

const KEY = 'lh.missionResults';
const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const write = (q) => {
  try {
    if (q.length) localStorage.setItem(KEY, JSON.stringify(q.slice(-10)));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: it still shows this session */
  }
};
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

// Pure: a synced check-in's mission still to do, or null.
export function missionToOffer(uid, d) {
  if (!uid || !d?.saved || !d.verified || d.sameDay || !d.landmarkId) return null;
  const landmark = { id: d.landmarkId, region: d.region || null, regionId: d.region || null, name: d.landmarkName || '' };
  if (!missionFor(landmark)) return null;
  if (missionDone(uid, d.landmarkId) || queuedMissionAnswer(uid, d.landmarkId)) return null;
  if (missionPhotoState(uid, d.landmarkId)?.status === 'checking') return null;
  return landmark;
}

function ReadyMission({ landmark, onDone }) {
  const [trivia, setTrivia] = useState(null);
  const [resultOpen, setResultOpen] = useState(false);
  const onTrivia = useCallback((e) => setTrivia(e.status === 'answered' ? { result: e.result } : e.status === 'answering' ? 'answering' : null), []);
  if (resultOpen && trivia?.result) return <MissionResult mission={missionFor(landmark)} result={trivia.result} onDone={onDone} />;
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Your mission at {landmark.name}</h3>
      <p className="screen-subtitle" style={{ marginTop: 0 }}>Your offline check-in synced, so it's ready now.</p>
      <MissionPanel landmark={landmark} checkedIn onTrivia={onTrivia} />
      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 16 }}
        disabled={trivia === 'answering'}
        onClick={() => (trivia?.result ? setResultOpen(true) : onDone())}
      >
        Done
      </button>
    </>
  );
}

export default function MissionResultSync() {
  const { user } = useAuth();
  const uid = user?.uid || null;
  const [queue, setQueue] = useState(read);
  const [inFront, setInFront] = useState(visible);
  useEffect(() => {
    const onResult = (e) => {
      const d = e?.detail;
      if (!d?.landmark || !d.result) return;
      setQueue((q) => [...q, { key: `r-${d.landmark.id}-${Date.now()}`, kind: 'result', uid: d.uid, landmark: d.landmark, result: d.result }]);
    };
    const vis = () => setInFront(visible());
    window.addEventListener(MISSION_RESULT_EVENT, onResult);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener(MISSION_RESULT_EVENT, onResult);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  useEffect(() => {
    if (!uid) return undefined;
    const onSynced = (e) => {
      const landmark = missionToOffer(uid, e?.detail);
      if (landmark) setQueue((q) => (q.some((x) => x.kind === 'ready' && x.landmark.id === landmark.id) ? q : [...q, { key: `m-${landmark.id}-${Date.now()}`, kind: 'ready', uid, landmark }]));
    };
    window.addEventListener(OFFLINE_CHECKIN_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OFFLINE_CHECKIN_SYNCED_EVENT, onSynced);
  }, [uid]);
  useEffect(() => write(queue), [queue]);
  const next = useCallback(() => setQueue((q) => q.slice(1)), []);
  const now = queue.find((x) => !uid || !x.uid || x.uid === uid);
  if (!now || !inFront || !uid) return null;
  const done = () => setQueue((q) => q.filter((x) => x.key !== now.key));
  return (
    <div className="modal-backdrop mission-sync-backdrop">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {now.kind === 'result' ? (
          <MissionResult key={now.key} mission={missionFor(now.landmark)} result={now.result} onDone={done} />
        ) : (
          <ReadyMission key={now.key} landmark={now.landmark} onDone={done} />
        )}
      </div>
    </div>
  );
}
