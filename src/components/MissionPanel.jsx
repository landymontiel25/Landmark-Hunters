import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { missionOf, missionDone, markMissionDone, submitMissionAnswer, loadServerMission, syncMissionDone, TRIVIA_PROMPT } from '../lib/missions';
import { checkMissionPhoto, takeMissionPhoto } from '../lib/missionPhoto';
import { queueMissionPhoto, missionPhotoState, MISSION_PHOTO_EVENT } from '../lib/missionPhotoQueue';
import { friendlyError } from '../lib/friendlyError';
import { TargetIcon } from './HeadingIcons';
import MissionComplete from './MissionComplete';
import { checksInAnywhere } from '../lib/admins';

// A landmark's mission (lib/missions.js), shown after a check-in is posted
// (CheckInReview) and on the landmark page. `checkedInAt` (ms) is this
// visit's check-in. `checkedIn` says you've checked in here before (any
// day): the mission then goes straight to its step, with no check-in prompt
// (owner, 2026-11-23). A photo mission then needs a photo taken here, now
// (after you tap the button), since that visit was another day.
//   Trivia: the owner's line, the question and four answers. One tap
//   answers; the server pays +10 for the right one, 0 for a wrong one.
//   Photo: the camera opens; the photo has to be taken here, after the
//   check-in, during this visit (lib/missionPhoto.js), and then show what
//   the mission asks: the server checks it (api/_lib/missionPhoto.js) and
//   pays +10 only for one that does. Nothing counts before that. That check
//   runs in the background (missionPhotoQueue.js, owner 2026-11-24): tap
//   Done and move on; a notice says how it went, and it waits for signal.
export default function MissionPanel({ landmark, checkedInAt = null, checkedIn = false, compact = false }) {
  const mission = missionOf(landmark);
  const { user } = useAuth();
  const uid = user?.uid || null;
  const [done, setDone] = useState(() => (landmark?.id ? missionDone(uid, landmark.id) : null));
  const [busy, setBusy] = useState(false);
  const [pendingTap, setPendingTap] = useState(null);
  const [note, setNote] = useState(null);
  // The "Mission completed" moment, shown once when a mission is finished here.
  const [celebrate, setCelebrate] = useState(null);
  const endCelebrate = useCallback(() => setCelebrate(null), []);
  // A photo checked in the background: 'checking', 'passed' or 'failed'
  // (with the two short lines), as kept on this phone.
  const [photoCheck, setPhotoCheck] = useState(() => (uid && landmark?.id ? missionPhotoState(uid, landmark.id) : null));
  useEffect(() => {
    if (!uid || !landmark?.id) return undefined;
    setPhotoCheck(missionPhotoState(uid, landmark.id));
    const on = (e) => {
      const d = e?.detail;
      if (!d || d.uid !== uid || d.landmarkId !== landmark.id) return;
      setPhotoCheck(d.state);
      if (d.state?.status === 'passed') {
        const result = { kind: 'photo', awarded: d.state.awarded || 0 };
        setDone(result);
        setCelebrate({ points: result.awarded });
        setNote(null);
      } else if (d.state?.status === 'failed') setNote({ lines: d.state.lines || [] });
    };
    window.addEventListener(MISSION_PHOTO_EVENT, on);
    return () => window.removeEventListener(MISSION_PHOTO_EVENT, on);
  }, [uid, landmark?.id]);
  // The server's record decides whether it's done (anti-farming item 4).
  const landmarkId = landmark?.id;
  useEffect(() => {
    if (!uid || !landmarkId || !mission) return undefined;
    let live = true;
    loadServerMission(uid, landmarkId).then((r) => {
      if (!live) return;
      syncMissionDone(uid, landmarkId, r);
      setDone(r);
    });
    return () => {
      live = false;
    };
  }, [uid, landmarkId, mission]);
  if (!mission) return null;
  const ready = (Number.isFinite(checkedInAt) || checkedIn) && !!uid;

  const answer = async (i) => {
    if (busy) return;
    setBusy(true);
    setPendingTap(i);
    setNote(null);
    try {
      const out = await submitMissionAnswer(landmark, i);
      const result = { kind: 'trivia', correct: !!out.correct, picked: out.picked ?? i, answer: out.answer };
      markMissionDone(uid, landmark.id, result);
      setDone(result);
      if (result.correct) setCelebrate({ points: out.awarded || 0 });
    } catch (e) {
      setNote(friendlyError(e, "Couldn't check your answer. Try again."));
    } finally {
      setPendingTap(null);
      setBusy(false);
    }
  };

  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    // Today's check-in starts the visit; after an earlier day's check-in,
    // the visit starts with this tap, so the photo must be taken from here on.
    const visitStart = Number.isFinite(checkedInAt) ? checkedInAt : Date.now();
    try {
      const shot = await takeMissionPhoto();
      if (!shot) return;
      const verdict = checkMissionPhoto({ landmark, checkedInAt: visitStart, photo: shot.photo, fileTime: shot.fileTime, device: shot.device, anywhere: checksInAnywhere(user) });
      if (!verdict.ok) {
        setNote(verdict.message);
        return;
      }
      // Checked against the mission in the background: it carries on after
      // this screen closes, and waits for signal when there's none.
      await queueMissionPhoto({ uid, landmark, file: shot.file });
    } catch (e) {
      setNote(friendlyError(e, "Couldn't use that photo. Try again."));
    } finally {
      setBusy(false);
    }
  };

  // A turned-down background check shows its two lines here too, wherever
  // the panel is opened again.
  const shownNote = note || (photoCheck?.status === 'failed' ? { lines: photoCheck.lines || [] } : null);
  const options = mission.options || [];
  return (
    <section className={`mission-panel${compact ? ' mission-panel-compact' : ''}`} aria-label="Mission">
      <h5 className="mission-head">
        <TargetIcon />
        Mission:
      </h5>
      <p className="mission-text">{mission.text}</p>

      {mission.type === 'trivia' && done?.kind === 'trivia' && (
        <p className="mission-result" role="status">
          {done.correct
            ? `${'✓'} Mission completed. Right: ${options[done.picked ?? done.answer] ?? ''}. +10 points.`
            : 'Not this time. One answer per place.'}
        </p>
      )}
      {mission.type === 'photo' && done?.kind === 'photo' && (
        <p className="mission-result" role="status">
          {'✓'} Mission completed.{done.awarded > 0 ? ` +${done.awarded} points.` : ''}
        </p>
      )}

      {!done && !ready && <p className="mission-hint">{uid ? 'Check in here to start it.' : 'Sign in and check in here to start it.'}</p>}

      {mission.type === 'trivia' && ((!done && ready) || done?.kind === 'trivia') && (
        <div className="mission-trivia">
          {!done && <p className="mission-prompt">{TRIVIA_PROMPT}</p>}
          <p className="mission-question">{mission.question}</p>
          <div className="mission-options" role="group" aria-label={mission.question} aria-busy={busy}>
            {options.map((o, i) => {
              // Your pick only: green when right, red when wrong. A wrong
              // pick never reveals the right one (owner, 2026-11-23).
              const answered = done?.kind === 'trivia';
              const state = !answered
                ? pendingTap === i
                  ? ' is-picked'
                  : ''
                : i === done.picked
                  ? done.correct
                    ? ' is-right'
                    : ' is-wrong'
                  : '';
              return (
                <button key={i} type="button" className={`mission-option${state}`} disabled={busy || answered} aria-pressed={answered ? i === done.picked : undefined} onClick={() => answer(i)}>
                  {o}
                  {state === ' is-right' && <span className="visually-hidden"> (right answer)</span>}
                  {state === ' is-wrong' && <span className="visually-hidden"> (your answer, wrong)</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!done && ready && mission.type === 'photo' && (
        photoCheck?.status === 'checking' && Date.now() - (photoCheck.at || 0) < 24 * 3600 * 1000 ? (
          <p className="mission-hint mission-checking" role="status">
            Checking your photo. You can tap Done and keep going: you'll get a notice, and the points if it passes.
          </p>
        ) : (
          <button type="button" className="btn btn-ghost btn-block mission-shoot" disabled={busy} aria-busy={busy} onClick={shoot}>
            {busy ? 'Saving your photo…' : note || photoCheck?.status === 'failed' ? `${'\u{1F4F8}'} Retake mission photo` : `${'\u{1F4F8}'} Take mission photo`}
          </button>
        )
      )}

      {shownNote?.lines ? (
        <ul className="mission-note" role="alert">
          {shownNote.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : (
        shownNote && (
          <p className="mission-note" role="alert">
            {shownNote}
          </p>
        )
      )}
      {celebrate && <MissionComplete landmarkName={landmark.name} points={celebrate.points} onDone={endCelebrate} />}
    </section>
  );
}
