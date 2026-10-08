import { useEffect, useState } from 'react';
import { useCheckIn } from '../lib/useCheckIn';
import { useAuth } from '../lib/AuthContext';
import { appendLoveNote, getLoveNote } from '../lib/reviews';
import { friendlyError } from '../lib/friendlyError';
import ErrorNotice from './ErrorNotice';

// Fires after the 3rd check-in at a landmark, then every 10th after that
// (13th, 23rd, ...) -- see shouldPromptLoveReason in leaderboard.js. The
// answer feeds Mapr's trait matching (maprPicks.js) via the review's
// loveNotes, so future picks match the SPECIFIC reason, not just the
// landmark's category. A repeat trigger offers a one-tap shortcut if the
// last answer is still true, instead of making someone retype it.
export default function LoveReasonPrompt() {
  const { loveReasonPrompt, clearLoveReasonPrompt, justCheckedIn } = useCheckIn();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [previousNote, setPreviousNote] = useState(null);
  const [saving, setSaving] = useState(false);
  // { note, err } for the last failed save -- the prompt stays open with
  // your text so Try again resends it instead of losing it.
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    setText('');
    setPreviousNote(null);
    setFailed(null);
    if (!loveReasonPrompt || !user) return;
    let cancelled = false;
    // Only powers the one-tap "same reason" shortcut -- if it can't load,
    // the prompt simply doesn't offer it.
    getLoveNote(user.uid, loveReasonPrompt.landmark.id)
      .then((note) => {
        if (!cancelled) setPreviousNote(note);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loveReasonPrompt, user]);

  // Waits for the check-in panel (and its celebration) to close: both are
  // full-screen layers, and this one used to cover the "Checked in!" burst.
  if (!loveReasonPrompt || justCheckedIn) return null;

  const save = async (note) => {
    if (!note.trim()) return;
    setSaving(true);
    setFailed(null);
    try {
      await appendLoveNote(user.uid, loveReasonPrompt.landmark.id, loveReasonPrompt.landmark, note);
    } catch (err) {
      // Never reads as the check-in failing (that already counted) -- just
      // this note, which can be retried or skipped.
      setFailed({ note, err });
      setSaving(false);
      return;
    }
    setSaving(false);
    clearLoveReasonPrompt();
  };

  return (
    <div className="modal-backdrop" onClick={() => !saving && clearLoveReasonPrompt()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{'\u{1F49B}'} Why do you love {loveReasonPrompt.landmark.name}?</h3>
        <p className="screen-subtitle" style={{ marginTop: 0 }}>
          You've been here {loveReasonPrompt.visitNumber} times now. Tell Mapr what keeps bringing you back — it
          helps us suggest places for the actual reason, not just the category.
        </p>

        {previousNote && (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            style={{ marginBottom: 10, textAlign: 'left' }}
            disabled={saving}
            onClick={() => save(previousNote)}
          >
            {'\u{1F501}'} I still love it for the same reason: <em>"{previousNote}"</em>
          </button>
        )}

        <textarea
          name="love-reason"
          aria-label={`Why you love ${loveReasonPrompt.landmark.name}`}
          autoComplete="off"
          className="rating-comment"
          rows={3}
          maxLength={280}
          placeholder="e.g. the rooftop view at sunset, it's always quiet on weekdays..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={saving}
        />

        {failed && (
          <ErrorNotice
            compact
            message={friendlyError(failed.err, "Couldn't save that. Your answer is still here — try again.")}
            onRetry={() => save(failed.note)}
          />
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={saving || !text.trim()}
            onClick={() => save(text)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={clearLoveReasonPrompt} disabled={saving}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
