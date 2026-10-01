import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { goBack } from '../lib/goBack';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { isAdmin } from '../lib/admins';
import {
  submitFeatureRequest,
  getPendingFeatureRequests,
  approveFeatureRequest,
  rejectFeatureRequest,
} from '../lib/featureRequests';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { usePersistentState, readPersisted, writePersisted, clearPersisted } from '../lib/usePersistentState';
import { SkeletonCard } from '../components/Skeleton';
import ErrorNotice from '../components/ErrorNotice';

const EMPTY_DRAFT = { title: '', description: '', reason: '' };
const draftIsEmpty = (d) => !d || (!d.title?.trim() && !d.description?.trim() && !d.reason?.trim());
const draftKey = (uid) => `featureRequest.${uid}`;

// Admin-only: the live queue of everything sitting in "pending", with
// Approve/Reject buttons -- same shape as Profile's PendingLandmarksPanel.
// firestore.rules is what actually enforces "only an admin can flip
// status" -- this tab just wouldn't be reachable for anyone else anyway.
function ReviewPanel() {
  const toast = useToast();
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getPendingFeatureRequests()
      .then((r) => {
        if (cancelled) return;
        setPending(r);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  // The card leaves the queue the moment you decide; if the write fails it
  // goes back where it was, with a Retry toast.
  const decide = (req, approve) => {
    const index = pending.findIndex((r) => r.id === req.id);
    runOptimistic({
      apply: () => setPending((cur) => cur.filter((r) => r.id !== req.id)),
      commit: () => (approve ? approveFeatureRequest(req.id) : rejectFeatureRequest(req.id)),
      rollback: () =>
        setPending((cur) => {
          if (cur.some((r) => r.id === req.id)) return cur;
          const next = [...cur];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, req);
          return next;
        }),
      toast,
      errorMessage: friendlyError(null, `Couldn't ${approve ? 'approve' : 'reject'} "${req.title}", so it's back in the queue.`),
      retry: () => decide(req, approve),
    });
  };

  if (loading) {
    return (
      <div role="status" aria-live="polite">
        <span className="visually-hidden">Loading pending requests…</span>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    );
  }
  if (loadError) {
    return (
      <ErrorNotice
        message={friendlyError(loadError, "We couldn't load the pending requests. Try again.")}
        onRetry={() => setLoadAttempt((n) => n + 1)}
      />
    );
  }
  if (pending.length === 0) {
    return <p className="screen-subtitle" style={{ textAlign: 'center', marginTop: 20 }}>Nothing pending — all caught up.</p>;
  }

  return (
    <div>
      {pending.map((r) => (
        <div key={r.id} className="card section">
          <h3 style={{ marginTop: 0 }}>{r.title}</h3>
          <p className="screen-subtitle" style={{ marginTop: -6 }}>Requested by {r.userName}</p>
          <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{r.description}</p>
          {r.reason && (
            <p className="screen-subtitle" style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>
              <strong>Why: </strong>
              {r.reason}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-success btn-tight" onClick={() => decide(r, true)}>
              {'\u{2713}'} Approve
            </button>
            <button type="button" className="btn btn-danger btn-tight" onClick={() => decide(r, false)}>
              {'\u{2715}'} Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// The form everyone sees: name, description, and why -- exactly what gets
// read (and, once approved, considered) on the other side.
// The draft is saved on this device as you type (per account), so leaving
// mid-sentence doesn't cost you the request; it's cleared once it's in.
function RequestForm({ user, onSubmit }) {
  const key = draftKey(user.uid);
  // Read once, before the hook below starts writing, to tell a restored
  // draft apart from one typed this visit.
  const [restored, setRestored] = useState(() => !draftIsEmpty(readPersisted(key)));
  const [draft, setDraft, clearDraft] = usePersistentState(key, EMPTY_DRAFT, { isEmpty: draftIsEmpty });
  const { title, description, reason } = { ...EMPTY_DRAFT, ...draft };
  const set = (field) => (e) => setDraft((cur) => ({ ...EMPTY_DRAFT, ...cur, [field]: e.target.value }));

  const canSubmit = title.trim() && description.trim() && reason.trim();

  const submit = () => {
    if (!canSubmit) return;
    // Flush now -- the debounced save won't get to run once this form
    // unmounts for the "Thanks!" card, and a failed send restores from here.
    writePersisted(key, { title, description, reason });
    onSubmit({ title, description, reason });
  };

  const discard = () => {
    clearDraft();
    setDraft(EMPTY_DRAFT);
    setRestored(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="screen-subtitle">
        Want a new feature? Request one here! We read every single request so don't be shy!
      </p>

      {restored && (
        <p className="draft-restored-note">
          Draft restored {'\u{00B7}'}{' '}
          <button type="button" onClick={discard}>
            Discard
          </button>
        </p>
      )}

      <div className="field">
        <label htmlFor="fr-title">Feature name</label>
        <input
          id="fr-title"
          name="feature-title"
          type="text"
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="next"
          maxLength={80}
          value={title}
          onChange={set('title')}
          placeholder="e.g. Dark mode for the map"
        />
      </div>

      <div className="field">
        <label htmlFor="fr-description">Explanation / description</label>
        <textarea
          id="fr-description"
          name="feature-description"
          autoComplete="off"
          autoCapitalize="sentences"
          rows={3}
          maxLength={1000}
          value={description}
          onChange={set('description')}
          placeholder="What should it do?"
        />
      </div>

      <div className="field">
        <label htmlFor="fr-reason">Why add this feature?</label>
        <textarea
          id="fr-reason"
          name="feature-reason"
          autoComplete="off"
          autoCapitalize="sentences"
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={set('reason')}
          placeholder="What problem does it solve, or why would it help?"
        />
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
        Submit Request
      </button>
    </form>
  );
}

export default function RequestFeature() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, firebaseEnabled } = useAuth();
  const { myUsername } = useFriends();
  const admin = isAdmin(user?.email);
  // A tap on the "new feature request" notification lands the admin
  // straight on the review tab instead of the form.
  const [tab, setTab] = useState(admin && location.state?.tab === 'review' ? 'review' : 'request');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const toast = useToast();

  // Optimistic: "Thanks!" shows right away and the write runs behind it. If
  // it fails, the form comes back with everything still filled in (the
  // draft was flushed to storage on submit) and a Retry toast.
  const submitRequest = (values) =>
    runOptimistic({
      apply: () => setJustSubmitted(true),
      commit: async () => {
        await submitFeatureRequest({
          userId: user.uid,
          userName: myUsername || user.displayName || user.email || 'Explorer',
          ...values,
        });
        clearPersisted(draftKey(user.uid));
      },
      rollback: () => setJustSubmitted(false),
      toast,
      errorMessage: friendlyError(null, "Your request didn't send. It's still filled in — try again."),
      retry: () => submitRequest(values),
    });

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => goBack(navigate, location)} style={{ marginBottom: 16 }}>
        {'← Back'}
      </button>

      <h1 className="screen-title">
        <span>{'\u{1F4A1}'}</span> Request a Feature
      </h1>

      {admin && (
        <div className="tabs" style={{ margin: '0 0 16px' }}>
          <button type="button" className={`tab-btn ${tab === 'request' ? 'active' : ''}`} aria-pressed={!!(tab === 'request')} onClick={() => setTab('request')}>
            Request a Feature
          </button>
          <button type="button" className={`tab-btn ${tab === 'review' ? 'active' : ''}`} aria-pressed={!!(tab === 'review')} onClick={() => setTab('review')}>
            Approve/Reject Features
          </button>
        </div>
      )}

      {!firebaseEnabled ? (
        <p className="screen-subtitle">Accounts aren't set up yet.</p>
      ) : !user ? (
        <p className="screen-subtitle">Sign in first (Profile tab) to request a feature.</p>
      ) : tab === 'review' ? (
        <ReviewPanel />
      ) : justSubmitted ? (
        <div className="card section" style={{ textAlign: 'center' }}>
          <h3 style={{ marginTop: 0 }}>{'\u{1F389}'} Thanks!</h3>
          <p className="screen-subtitle" style={{ margin: 0 }}>Your request is in — we read every one.</p>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setJustSubmitted(false)}>
            Submit another
          </button>
        </div>
      ) : (
        <RequestForm user={user} onSubmit={submitRequest} />
      )}
    </div>
  );
}
