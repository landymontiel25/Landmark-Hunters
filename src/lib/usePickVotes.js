import { useCallback, useEffect, useRef, useState } from 'react';
import { flushPendingPickVotes, getPickFeedback, readPendingPickVotes, setPickFeedback } from './pickFeedback';

// State behind the three pick buttons (PickVoteButtons.jsx) on every surface.
//
//   votes[landmarkId] = { verdict, status, tryingVerdict }
//     verdict        the SAVED answer ('yes' | 'unsure' | 'no'), shown as selected.
//                    It changes only after the database write succeeded.
//     status         'idle' | 'saving' | 'pending' (offline, not saved yet) | 'error'
//     tryingVerdict  the tap in flight / waiting / failed (never shown as selected)
//   removed          Set of landmark ids answered "Not for me" this session (or,
//                    with removeOnAnyVote, answered at all): the card leaves and
//                    the next pick takes its place.
//
// onSaved(entry) runs after a successful save (e.g. refresh a badge count).
export function usePickVotes({ uid, origin = null, onSaved = null, removeOnAnyVote = false }) {
  const [votes, setVotes] = useState({});
  const [removed, setRemoved] = useState(() => new Set());
  const ctx = useRef({});
  ctx.current = { uid, origin, onSaved, removeOnAnyVote };
  const last = useRef({}); // landmarkId -> { landmark, verdict, requestFor } for Try again
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const patch = useCallback((id, p) => {
    if (!alive.current) return;
    setVotes((cur) => ({ ...cur, [id]: { verdict: null, status: 'idle', tryingVerdict: null, ...cur[id], ...p } }));
  }, []);

  const applySaved = useCallback(
    (entry) => {
      if (!alive.current) return;
      setVotes((cur) => ({ ...cur, [entry.landmarkId]: { verdict: entry.verdict, status: 'idle', tryingVerdict: null } }));
      // Not for me always takes the card out. Where a place is asked about once
      // (the Profile carousel), any answer does: it is already answered.
      if (entry.verdict === 'no' || ctx.current.removeOnAnyVote) setRemoved((cur) => new Set(cur).add(entry.landmarkId));
      ctx.current.onSaved?.(entry);
    },
    []
  );

  // Answers already saved (so a returning user sees them selected), plus any
  // tap still waiting offline, flagged "not saved yet".
  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    getPickFeedback(uid)
      .then((fb) => {
        if (cancelled) return;
        setVotes((cur) => {
          const next = { ...cur };
          for (const [id, f] of Object.entries(fb)) if (!next[id]) next[id] = { verdict: f.verdict, status: 'idle', tryingVerdict: null };
          return next;
        });
      })
      .catch(() => {});
    const pending = readPendingPickVotes(uid);
    setVotes((cur) => {
      const next = { ...cur };
      for (const [id, e] of Object.entries(pending)) next[id] = { verdict: next[id]?.verdict ?? null, status: 'pending', tryingVerdict: e.verdict };
      return next;
    });
    const flush = () =>
      flushPendingPickVotes(uid)
        .then((saved) => saved.forEach(applySaved))
        .catch(() => {});
    flush();
    window.addEventListener('online', flush);
    return () => {
      cancelled = true;
      window.removeEventListener('online', flush);
    };
  }, [uid, applySaved]);

  const vote = useCallback(
    async (landmark, verdict, { requestFor = null } = {}) => {
      const { uid: u, origin: o } = ctx.current;
      if (!u || !landmark?.id) return null;
      last.current[landmark.id] = { landmark, verdict, requestFor };
      patch(landmark.id, { status: 'saving', tryingVerdict: verdict });
      try {
        const res = await setPickFeedback({ uid: u, landmark, verdict, origin: o, requestFor });
        if (res.status === 'pending') patch(landmark.id, { status: 'pending', tryingVerdict: verdict });
        else applySaved(res.entry);
        return res;
      } catch (e) {
        patch(landmark.id, { status: 'error', tryingVerdict: verdict });
        return null;
      }
    },
    [patch, applySaved]
  );

  const retry = useCallback(
    (landmarkId) => {
      const l = last.current[landmarkId];
      return l ? vote(l.landmark, l.verdict, { requestFor: l.requestFor }) : null;
    },
    [vote]
  );

  return { votes, removed, vote, retry };
}
