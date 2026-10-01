import { useEffect, useState } from 'react';
import { getReplies, addReply, deleteReply } from '../lib/reviews';
import { useFriends } from '../lib/FriendsContext';
import { usePersistentState, readPersisted } from '../lib/usePersistentState';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { SkeletonText } from './Skeleton';
import ErrorNotice from './ErrorNotice';

// One reply level under a review -- lazily loaded (only fetched once
// expanded) since most reviews on a landmark page will never be opened.
export default function ReviewReplies({ reviewId, currentUser, reviewAuthorUid }) {
  const { myUsername } = useFriends();
  const toast = useToast();
  // A half-written reply survives closing the app (per account + review).
  const draftKey = currentUser ? `reply.${currentUser.uid}.${reviewId}` : null;
  const [draft, setDraft, clearDraft] = usePersistentState(draftKey, '');
  // Reopen the thread if there's a reply waiting in it, so the restored
  // text isn't hidden behind a collapsed "Replies" button.
  const [restored, setRestored] = useState(() => !!(draftKey && readPersisted(draftKey)));
  const [open, setOpen] = useState(restored);
  const [replies, setReplies] = useState(null); // null = not loaded yet
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      setReplies(await getReplies(reviewId));
    } catch (e) {
      // "Couldn't load" must not look like "No replies yet".
      if (!quiet) setLoadError(e);
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (open && replies === null && !loading && !loadError) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = () => setOpen((o) => !o);

  // Optimistic: the reply appears (slightly faded) the moment you tap Post
  // and the box clears; on failure it's pulled back out and your text is put
  // back in the box, with a Retry.
  const handleAdd = (textArg) => {
    const text = (typeof textArg === 'string' ? textArg : draft).trim();
    if (!text || !currentUser) return;
    const tempId = `pending-${Date.now()}`;
    const userName = myUsername || currentUser.displayName || 'Explorer';
    runOptimistic({
      apply: () => {
        setReplies((cur) => [...(cur || []), { id: tempId, uid: currentUser.uid, userName, text, pending: true }]);
        setDraft('');
        clearDraft();
        setRestored(false);
      },
      commit: async () => {
        const realId = await addReply(reviewId, { uid: currentUser.uid, userName, text });
        // Settle the placeholder right away (real id, no longer faded) so it
        // can be deleted even if the refresh below fails (e.g. goes offline).
        if (realId) setReplies((cur) => (cur || []).map((r) => (r.id === tempId ? { ...r, id: realId, pending: false } : r)));
        // Swap the placeholder for the real doc (real id, so Delete works).
        await load({ quiet: true });
      },
      rollback: () => {
        setReplies((cur) => (cur || []).filter((r) => r.id !== tempId));
        setDraft((cur) => cur || text);
      },
      toast,
      errorMessage: "Your reply didn't post. It's back in the box.",
      retry: () => {
        setDraft('');
        handleAdd(text);
      },
    });
  };

  const handleDelete = (replyId) => {
    const before = replies;
    runOptimistic({
      apply: () => setReplies((cur) => (cur || []).filter((r) => r.id !== replyId)),
      commit: () => deleteReply(reviewId, replyId),
      rollback: () => setReplies(before),
      toast,
      errorMessage: "Couldn't delete that reply, so we put it back.",
      retry: () => handleDelete(replyId),
    });
  };

  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" className="btn btn-ghost btn-tight" onClick={toggle} aria-expanded={open}>
        {open ? 'Hide replies' : `Replies${replies?.length ? ` (${replies.length})` : ''}`}
      </button>
      {open && (
        <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '2px solid rgba(255,255,255,0.12)' }}>
          {loading && (
            <div role="status" aria-live="polite" style={{ marginBottom: 6 }}>
              <span className="visually-hidden">Loading replies…</span>
              <SkeletonText lines={2} lastWidth="45%" />
            </div>
          )}
          {loadError && !loading && (
            <ErrorNotice
              compact
              message={friendlyError(loadError, "Couldn't load replies.")}
              onRetry={() => load()}
            />
          )}
          {replies?.map((r) => (
            <div key={r.id} style={{ marginBottom: 6, opacity: r.pending ? 0.6 : 1 }}>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                <strong>{r.userName}</strong> {r.text}
              </p>
              {!r.pending && currentUser && (r.uid === currentUser.uid || reviewAuthorUid === currentUser.uid) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-tight"
                  style={{ fontSize: '0.7rem' }}
                  onClick={() => handleDelete(r.id)}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
          {replies?.length === 0 && !loading && (
            <p className="screen-subtitle" style={{ margin: 0 }}>
              No replies yet.
            </p>
          )}
          {currentUser && (
            <>
              <form
                style={{ display: 'flex', gap: 6, marginTop: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAdd();
                }}
              >
                <input
                  type="text"
                  name="reply"
                  aria-label="Write a reply"
                  autoComplete="off"
                  enterKeyHint="send"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Write a reply…"
                  maxLength={500}
                  style={{ flex: 1 }}
                  className="friend-email-input"
                />
                <button type="submit" className="btn btn-primary btn-tight" disabled={!draft.trim()}>
                  Post
                </button>
              </form>
              {restored && draft && (
                <p className="draft-restored-note">
                  Draft restored {'\u{00B7}'}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setDraft('');
                      clearDraft();
                      setRestored(false);
                    }}
                  >
                    Discard
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
