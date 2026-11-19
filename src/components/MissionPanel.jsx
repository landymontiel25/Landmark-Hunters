import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { missionOf, missionDone, markMissionDone, submitMissionAnswer, TRIVIA_PROMPT } from '../lib/missions';
import { checkMissionPhoto, takeMissionPhoto } from '../lib/missionPhoto';
import { attachCheckinPhoto } from '../lib/leaderboard';
import { friendlyError } from '../lib/friendlyError';

// A landmark's mission (lib/missions.js), shown after a check-in is posted
// (CheckInReview) and on the landmark page. `checkedInAt` (ms) is this
// visit's check-in; without one the mission only says what to do.
//   Trivia: the owner's line, the question and four answers. One tap
//   answers; the server pays +10 for the right one, 0 for a wrong one.
//   Photo: the camera opens; the photo has to be taken here, after the
//   check-in, during this visit (lib/missionPhoto.js).
export default function MissionPanel({ landmark, checkedInAt = null, compact = false }) {
  const mission = missionOf(landmark);
  const { user } = useAuth();
  const toast = useToast();
  const uid = user?.uid || null;
  const [done, setDone] = useState(() => (landmark?.id ? missionDone(uid, landmark.id) : null));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  if (!mission) return null;
  const ready = Number.isFinite(checkedInAt) && !!uid;

  const answer = async (i) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const out = await submitMissionAnswer(landmark, i);
      const result = { kind: 'trivia', correct: !!out.correct, picked: out.picked ?? i, answer: out.answer };
      markMissionDone(uid, landmark.id, result);
      setDone(result);
      if (out.awarded > 0) toast.show(`+${out.awarded} pts: you got it right.`, { tone: 'success' });
    } catch (e) {
      setNote(friendlyError(e, "Couldn't check your answer. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const shot = await takeMissionPhoto();
      if (!shot) return;
      const verdict = checkMissionPhoto({ landmark, checkedInAt, photo: shot.photo, fileTime: shot.fileTime, device: shot.device });
      if (!verdict.ok) {
        setNote(verdict.message);
        return;
      }
      const result = { kind: 'photo' };
      markMissionDone(uid, landmark.id, result);
      setDone(result);
      // Kept with this visit, like any check-in photo. Best effort: the
      // mission counts even if the upload doesn't.
      attachCheckinPhoto(uid, landmark.id, shot.file).catch(() => {});
    } catch (e) {
      setNote(friendlyError(e, "Couldn't use that photo. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const options = mission.options || [];
  return (
    <section className={`mission-panel${compact ? ' mission-panel-compact' : ''}`} aria-label="Mission">
      <h5 className="mission-head">
        <svg className="mission-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
        Mission:
      </h5>
      <p className="mission-text">{mission.text}</p>

      {mission.type === 'trivia' && done?.kind === 'trivia' && (
        <p className="mission-result" role="status">
          {done.correct
            ? `${'✓'} Right: ${options[done.answer] ?? ''}. +10 points.`
            : `Not this time. The answer is ${options[done.answer] ?? 'shown on the landmark page'}.`}
        </p>
      )}
      {mission.type === 'photo' && done?.kind === 'photo' && (
        <p className="mission-result" role="status">
          {'✓'} Photo checked. Mission done.
        </p>
      )}

      {!done && !ready && <p className="mission-hint">{uid ? 'Check in here to start it.' : 'Sign in and check in here to start it.'}</p>}

      {!done && ready && mission.type === 'trivia' && (
        <div className="mission-trivia">
          <p className="mission-prompt">{TRIVIA_PROMPT}</p>
          <p className="mission-question">{mission.question}</p>
          <div className="mission-options" role="group" aria-label={mission.question} aria-busy={busy}>
            {options.map((o, i) => (
              <button key={i} type="button" className="mission-option" disabled={busy} onClick={() => answer(i)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      )}

      {!done && ready && mission.type === 'photo' && (
        <button type="button" className="btn btn-ghost btn-block mission-shoot" disabled={busy} aria-busy={busy} onClick={shoot}>
          {busy ? 'Checking your photo…' : note ? `${'\u{1F4F8}'} Retake mission photo` : `${'\u{1F4F8}'} Take mission photo`}
        </button>
      )}

      {note && (
        <p className="mission-note" role="alert">
          {note}
        </p>
      )}
    </section>
  );
}
