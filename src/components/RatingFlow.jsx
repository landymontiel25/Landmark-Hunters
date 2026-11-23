import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TIERS,
  WOULD_RETURN,
  MAX_ASPECTS,
  COMMENT_MAX,
  aspectsFor,
  aspectLabel,
  tierQuestion,
  commentQuestion,
} from '../lib/ratingFlow';
import { usePersistentState, readPersisted, isDraftSubmitting } from '../lib/usePersistentState';
import TagFriendsPicker from './TagFriendsPicker';

const NO_TAGS = [];

function toDraft(initial) {
  return {
    tier: initial?.tier || null,
    highlights: initial?.highlights || [],
    lovedOrder: initial?.lovedOrder || [],
    dislikedOrder: initial?.dislikedOrder || [],
    comment: initial?.comment || '',
    visitFrequency: initial?.visitFrequency || null,
    // "Would you come back?" -- optional, asked alongside the tier. Mapr's
    // strongest signal for the next picks (tagScores.ratingDelta).
    wouldReturn: initial?.wouldReturn || null,
    // Friends tagged in this rating: [{ uid, name }]. Not stored on the
    // review; reviews.js notifies them when it saves.
    tagged: [],
  };
}

// The rating: tier -> ranked aspects. Shared by the
// check-in popup and the landmark page's "Rate your visit" card so both
// entry points produce the identical review shape.
//
// Reports upward via onChange as { tier, highlights, lovedOrder,
// dislikedOrder, visitFrequency, wouldReturn } (or null before a tier is
// picked). Everything past the tier is optional -- a tier alone is a
// complete, saveable rating, so the fastest path stays one tap.
// wouldReturn ("Would you come back?") is Mapr's strongest signal for the
// next picks, stronger than the tier itself (tagScores.ratingDelta).
//
// Ranking is tap-to-rank, not drag: the first aspect you tap is #1, the next
// #2, and so on, with the number shown on the button; tapping a ranked one
// removes it and the rest close up. Same ordered list as a drag handle would
// give, without a drag gesture that's fiddly on a phone inside a modal.
//
// draftKey (see ratingDraftKey in reviews.js): when given, a rating in
// progress is saved on this device as you tap, so closing the app mid-rating
// doesn't lose it. The parent clears it once the rating actually saves.
// tagUid: the signed-in rater, for "@ Tag a friend" (left out, no tagging).
export default function RatingFlow({ landmark, onChange, initial = null, requireComment = false, draftKey = null, tagUid = null }) {
  // A draft identical to what's already on file (or with no tier) isn't
  // worth keeping -- it would only "restore" what the form shows anyway.
  const initialJson = JSON.stringify(toDraft(initial));
  const isEmpty = useCallback((d) => !d?.tier || JSON.stringify(d) === initialJson, [initialJson]);
  const [restored, setRestored] = useState(() => {
    const saved = draftKey ? readPersisted(draftKey) : undefined;
    return !!saved && !isEmpty(saved) && !isDraftSubmitting(draftKey);
  });
  const [draft, setDraft, clearDraft] = usePersistentState(draftKey, () => toDraft(initial), { isEmpty });
  const { tier, highlights, lovedOrder, dislikedOrder, comment, visitFrequency, wouldReturn } = draft;
  const tagged = draft.tagged || NO_TAGS;
  const patch = (fields) => setDraft((cur) => ({ ...cur, ...fields }));
  const setLovedOrder = (list) => patch({ lovedOrder: list });
  const setDislikedOrder = (list) => patch({ dislikedOrder: list });
  const pickWouldReturn = (id) => patch({ wouldReturn: wouldReturn === id ? null : id });
  // Free text, optional: the one place to say what the chips can't. Mapr
  // reads it alongside the chips when learning what you like.
  const setComment = (text) => patch({ comment: text });
  // Tagging adds "@name" to the comment (so the rating shows who it's for);
  // untagging takes it back out.
  const setTagged = (list, { added, removed } = {}) => {
    const at = (name) => `@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
    let text = comment;
    if (added && !new RegExp(at(added.name), 'i').test(text)) text = `${text.trim()} @${added.name}`.trim().slice(0, COMMENT_MAX);
    if (removed) text = text.replace(new RegExp(`\\s*${at(removed.name)}`, 'gi'), '').trim();
    patch({ tagged: list, comment: text });
  };

  const discardDraft = () => {
    clearDraft();
    setDraft(toDraft(initial));
    setRestored(false);
  };

  const payload = useMemo(
    () =>
      tier
        ? { tier, highlights, lovedOrder, dislikedOrder, comment: comment.trim(), visitFrequency, wouldReturn, ...(tagged.length ? { tagged } : {}) }
        : null,
    [tier, highlights, lovedOrder, dislikedOrder, comment, visitFrequency, wouldReturn, tagged]
  );
  useEffect(() => {
    onChange?.(payload);
    // onChange identity changes every parent render; the payload is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const pickTier = (id) => {
    if (id === tier) return;
    // Chips are tier-specific, and a "probably skip" has no loved aspects
    // (and vice versa) -- start those over rather than carry stale picks.
    patch({ tier: id, highlights: [], lovedOrder: [], dislikedOrder: [] });
  };

  const toggleRank = (setList, list, id) => {
    if (list.includes(id)) setList(list.filter((a) => a !== id));
    else if (list.length < MAX_ASPECTS) setList([...list, id]);
  };

  const question = tierQuestion(landmark);
  const showLoved = tier === 'highly-recommend' || tier === 'worth-trying';
  const showDisliked = tier === 'probably-skip' || tier === 'worth-trying';

  const rankList = ({ title, list, setList, excluded }) => (
    <div style={{ marginTop: 14 }}>
      <p className="rating-flow-label">
        {title} <span>tap in order, up to {MAX_ASPECTS}</span>
      </p>
      <div className="chip-grid">
        {aspectsFor(landmark).map((a) => {
          const rank = list.indexOf(a.id);
          const taken = excluded.includes(a.id);
          const full = rank < 0 && list.length >= MAX_ASPECTS;
          return (
            <button
              key={a.id}
              type="button"
              className={`chip rating-aspect ${rank >= 0 ? 'selected' : ''} ${taken || full ? 'disabled' : ''}`}
              aria-pressed={rank >= 0}
              disabled={taken || full}
              onClick={() => toggleRank(setList, list, a.id)}
            >
              <span className="rating-aspect-rank">{rank >= 0 ? rank + 1 : ''}</span>
              <span>{aspectLabel(a.id)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="rating-flow">
      {restored && (
        <p className="draft-restored-note">
          {'\u{1F4DD}'} Your unsaved rating was restored {'\u{00B7}'}{' '}
          <button type="button" onClick={discardDraft}>
            Discard
          </button>
        </p>
      )}
      {question && <p className="rating-flow-question">{question}</p>}
      <div className="rating-tier-grid">
        {TIERS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chip rating-tier ${tier === t.id ? 'selected' : ''}`}
            aria-pressed={tier === t.id}
            onClick={() => pickTier(t.id)}
          >
            <span className="chip-icon">{t.emoji}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Mapr's strongest signal for the next picks (owner, 2026-11-17),
          right under the tier question ("Do you like the outdoors here?"
          and the like), its second (owner, 2026-11-23: these two first).
          A clear "Yes!" or "Never again" can turn around what the tier
          alone would have said. */}
      {tier && (
        <div style={{ marginTop: 14 }}>
          <p className="rating-flow-question">Would you come back?</p>
          <div className="rating-tier-grid">
            {WOULD_RETURN.map((w) => (
              <button
                key={w.id}
                type="button"
                className={`chip rating-tier ${wouldReturn === w.id ? 'selected' : ''}`}
                aria-pressed={wouldReturn === w.id}
                onClick={() => pickWouldReturn(w.id)}
              >
                <span className="chip-icon">{w.emoji}</span>
                <span>{w.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* "How often do you come here?" is gone (owner, 2026-11-23): the two
          questions above it are the ones that count. An older rating keeps
          the answer it has. */}

      {showLoved &&
        rankList({
          title: 'What made it great?',
          list: lovedOrder,
          setList: setLovedOrder,
          excluded: dislikedOrder,
        })}
      {showDisliked &&
        rankList({
          title: 'What let it down?',
          list: dislikedOrder,
          setList: setDislikedOrder,
          excluded: lovedOrder,
        })}

      {tier && (
        <div style={{ marginTop: 14 }}>
          <p className="rating-flow-label">
            {commentQuestion(tier)} <span>{requireComment ? 'required' : 'optional'}</span>
          </p>
          <textarea
            name="comment"
            aria-label="Your comment"
            autoComplete="off"
            enterKeyHint="done"
            className="rating-comment"
            rows={2}
            maxLength={COMMENT_MAX}
            placeholder="In your own words — Mapr reads this to learn your taste"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <TagFriendsPicker uid={tagUid} tagged={tagged} onChange={setTagged} />
        </div>
      )}
      {/* Under the rating questions (owner, 2026-11-17): why it's safe, and
          why an honest no still helps. */}
      <p className="rating-flow-privacy">Only Mapr sees this. The place never sees it, and your friends never see it.</p>
      <p className="rating-flow-privacy">
        An honest no helps Mapr more than a polite ok. It stops me sending you to places like this again.
      </p>
    </div>
  );
}
