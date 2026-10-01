import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { saveTasteBaseline } from '../lib/friends';
import { TASTE_QUESTIONS } from '../lib/tasteQuestions';
import { useToast } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { readPersisted, writePersisted, clearPersisted } from '../lib/usePersistentState';

const draftKey = (uid) => `tasteBaseline.${uid}`;

// The write itself, outside the component: Save closes the card right away
// (optimistic), so a failure -- and its Retry -- has to work after this
// card is gone. The picks sit in the draft until the write lands, so even a
// Retry that also fails loses nothing: the next Edit restores them.
function commitBaseline(uid, values, reloadFriends) {
  writePersisted(draftKey(uid), values);
  return saveTasteBaseline(uid, values).then(async () => {
    clearPersisted(draftKey(uid));
    await reloadFriends();
  });
}

function reportFailure(err, uid, values, reloadFriends, toast) {
  console.error('[TasteNudgeCard] saveTasteBaseline failed:', err);
  toast.show(friendlyError(err, "Your taste picks didn't save. They're kept on this device — tap Edit to see them."), {
    actionLabel: 'Retry',
    onAction: () =>
      commitBaseline(uid, values, reloadFriends).catch((e) => reportFailure(e, uid, values, reloadFriends, toast)),
  });
}

// The "you haven't told Mapr what you like yet" nudge, expanded into
// something answerable in a few taps instead of a blank box: one quick
// example question per category ("Food: like or hate any of these?"),
// generated instantly from a fixed local list (no AI round trip to wait
// on). Every chip is tri-state (tap: neutral -> like -> dislike -> neutral)
// -- this is meant to become the BASELINE Mapr starts every suggestion
// from, likes AND dislikes both; individual landmark ratings then refine it
// further with specific reasons ("no pepper on my steak") as they come in,
// same as always. Each category also has its own optional Comment field
// (e.g. "no pepper on my steak") -- feeds Mapr's analysis alongside the
// picks (see baselineToSyntheticReviews' comment field), not just a
// separate note nobody reads.
//
// Also doubles as the edit flow: TasteProfileCard's Edit button reopens
// this same card pre-filled from the saved baseline (initialBaseline/
// initialNotes/initialCategoryNotes), so resubmitting after a change
// replaces the old answers rather than piling a new sentence on top of
// them (see saveTasteBaseline).
export default function TasteNudgeCard({
  onDone,
  onDismiss,
  initialBaseline,
  initialNotes,
  initialCategoryNotes,
  editing = false,
}) {
  const { user } = useAuth();
  const { reload: reloadFriends } = useFriends();
  const toast = useToast();
  // Unsaved picks from an earlier visit (the app closed mid-edit, or a save
  // that failed) win over the saved baseline, with a note saying so.
  const [restoredDraft, setRestoredDraft] = useState(() => (user ? readPersisted(draftKey(user.uid)) || null : null));
  const seed = restoredDraft || { baseline: initialBaseline, notes: initialNotes, categoryNotes: initialCategoryNotes };
  // Deep-copy the initial baseline into per-category Sets-as-objects so
  // editing here never mutates the profile's own object by reference.
  const [picked, setPicked] = useState(() => {
    const init = {};
    for (const [catId, cat] of Object.entries(seed.baseline || {})) init[catId] = { ...cat };
    return init;
  });
  const [extra, setExtra] = useState(seed.notes || '');
  const [categoryNotes, setCategoryNotes] = useState(() => ({ ...(seed.categoryNotes || {}) }));
  const [openComments, setOpenComments] = useState(
    () => new Set(Object.keys(seed.categoryNotes || {}).filter((id) => seed.categoryNotes[id]))
  );
  // The initial props are snapshotted into state once on mount (above). If
  // this opened before the profile's server read had landed, that snapshot
  // is empty even though real picks exist -- so as long as the traveler
  // hasn't touched anything yet, adopt the picks whenever they do arrive
  // instead of leaving them staring at a blank editor. Any edit flips this
  // and the seeded state is never overwritten from underneath them.
  const dirtyRef = useRef(!!restoredDraft);
  useEffect(() => {
    if (dirtyRef.current) return;
    const init = {};
    for (const [catId, cat] of Object.entries(initialBaseline || {})) init[catId] = { ...cat };
    setPicked(init);
    setExtra(initialNotes || '');
    setCategoryNotes({ ...(initialCategoryNotes || {}) });
    setOpenComments(new Set(Object.keys(initialCategoryNotes || {}).filter((id) => initialCategoryNotes[id])));
  }, [initialBaseline, initialNotes, initialCategoryNotes]);

  const cycleChip = (categoryId, example) => {
    dirtyRef.current = true;
    setPicked((prev) => {
      const cat = { ...(prev[categoryId] || {}) };
      const cur = cat[example];
      const next = cur === undefined ? 'like' : cur === 'like' ? 'dislike' : undefined;
      if (next === undefined) delete cat[example];
      else cat[example] = next;
      return { ...prev, [categoryId]: cat };
    });
  };

  const toggleComment = (categoryId) => {
    dirtyRef.current = true;
    setOpenComments((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  // In-progress edits are saved to this device as you go (only once you've
  // actually changed something), so leaving mid-edit doesn't lose them.
  useEffect(() => {
    if (!user || !dirtyRef.current) return undefined;
    const t = setTimeout(() => writePersisted(draftKey(user.uid), { baseline: picked, notes: extra, categoryNotes }), 300);
    return () => clearTimeout(t);
  }, [user, picked, extra, categoryNotes]);

  const discardDraft = () => {
    if (user) clearPersisted(draftKey(user.uid));
    dirtyRef.current = false;
    setRestoredDraft(null);
    const init = {};
    for (const [catId, cat] of Object.entries(initialBaseline || {})) init[catId] = { ...cat };
    setPicked(init);
    setExtra(initialNotes || '');
    setCategoryNotes({ ...(initialCategoryNotes || {}) });
    setOpenComments(new Set(Object.keys(initialCategoryNotes || {}).filter((id) => initialCategoryNotes[id])));
  };

  // Closing with X is "never mind" -- don't bring these edits back next time.
  const dismiss = () => {
    if (user && dirtyRef.current) clearPersisted(draftKey(user.uid));
    onDismiss();
  };

  const totalPicked = Object.values(picked).reduce((n, cat) => n + Object.keys(cat).length, 0);

  // Optimistic: the card closes with the new picks immediately and the
  // write runs behind it. `committed` lets the caller (TasteProfileCard)
  // hold the just-saved values until the write lands -- bridging the gap
  // between "Save tapped" and "the FriendsContext re-render carrying it"
  // so the confidence score doesn't flash the wrong thing -- and drop them
  // if it fails. Nothing typed is lost on failure: the picks stay in the
  // draft (restored on the next Edit) and a toast offers Retry.
  const save = () => {
    const cleanCategoryNotes = Object.fromEntries(Object.entries(categoryNotes).filter(([, v]) => v?.trim()));
    const values = { baseline: picked, notes: extra, categoryNotes: cleanCategoryNotes };
    const committed = commitBaseline(user.uid, values, reloadFriends);
    committed.catch((e) => reportFailure(e, user.uid, values, reloadFriends, toast));
    onDone(values, committed);
  };

  return (
    <div className="card section taste-nudge-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
            {'\u{1F44B}'} {editing ? 'Edit what you told Mapr' : "Tell Mapr what you like — and don't"}
          </h3>
          <p className="screen-subtitle" style={{ margin: '4px 0 0' }}>
            {editing
              ? 'Change any pick, add notes, then save — this replaces your saved baseline.'
              : "Or just say it in the chat — either way counts and you won't see this again. This becomes your baseline; rating actual landmarks fills in the specifics later."}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={dismiss} aria-label="Dismiss">
          {'\u{2715}'}
        </button>
      </div>

      {restoredDraft && (
        <p className="draft-restored-note" style={{ marginTop: 8 }}>
          Unsaved picks restored {'\u{00B7}'}{' '}
          <button type="button" onClick={discardDraft}>
            Discard
          </button>
        </p>
      )}

      <ul
        className="screen-subtitle"
        style={{ margin: '10px 0 0', fontSize: '0.75rem', display: 'flex', gap: 12, flexWrap: 'wrap', padding: 0, listStyle: 'none' }}
      >
        <li>Tap 1x for {'\u{1F44D}'} like</li>
        <li>Tap 2x for {'\u{1F44E}'} dislike</li>
        <li>Tap 3x to clear</li>
      </ul>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        {TASTE_QUESTIONS.map((q) => {
          const commentOpen = openComments.has(q.id);
          const hasComment = !!categoryNotes[q.id]?.trim();
          return (
            <div key={q.id}>
              <p style={{ margin: '0 0 4px', fontSize: '0.82rem', fontWeight: 600 }}>
                {q.icon} {q.label} — <span style={{ fontWeight: 400 }}>{q.prompt}</span>{' '}
                <button
                  type="button"
                  onClick={() => toggleComment(q.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontFamily: 'inherit',
                    fontSize: '0.75rem',
                    fontWeight: 400,
                    color: hasComment ? 'var(--color-brass-bright, inherit)' : 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  {'\u{1F4AC}'} {hasComment ? 'Comment ✓' : 'Comment'}
                </button>
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {q.examples.map((ex) => {
                  const state = picked[q.id]?.[ex];
                  return (
                    <button
                      key={ex}
                      type="button"
                      className={`tag ${state === 'like' ? 'tag-active' : ''} ${state === 'dislike' ? 'tag-dislike' : ''}`}
                      aria-pressed={!!state}
                      style={{ cursor: 'pointer', fontFamily: 'inherit', appearance: 'none' }}
                      onClick={() => cycleChip(q.id, ex)}
                        >
                      {state === 'like' ? `${'\u{1F44D}'} ` : state === 'dislike' ? `${'\u{1F44E}'} ` : ''}
                      {ex}
                    </button>
                  );
                })}
              </div>
              {commentOpen && (
                <textarea
                  className="rating-comment"
                  rows={2}
                  maxLength={2000}
                  placeholder={`Anything specific about ${q.label.toLowerCase()}? e.g. "no pepper on my steak"`}
                  value={categoryNotes[q.id] || ''}
                  onChange={(e) => {
                    dirtyRef.current = true;
                    setCategoryNotes((prev) => ({ ...prev, [q.id]: e.target.value }));
                  }}
                  style={{ marginTop: 6 }}
                />
              )}
            </div>
          );
        })}
      </div>

      <textarea
        className="rating-comment"
        rows={2}
        maxLength={2000}
        placeholder="Anything else, liked or hated? (optional)"
        value={extra}
        onChange={(e) => {
          dirtyRef.current = true;
          setExtra(e.target.value);
        }}
        style={{ marginTop: 12 }}
      />

      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 14 }}
        disabled={!editing && totalPicked === 0 && !extra.trim()}
        onClick={save}
      >
        {totalPicked > 0 ? `Save (${totalPicked} picked)` : 'Save'}
      </button>
    </div>
  );
}
