import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { goBack } from '../lib/goBack';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { isAdmin } from '../lib/admins';
import { submitBugReport, getPendingBugReports, resolveBugReport, dismissBugReport } from '../lib/bugReports';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { usePersistentState, readPersisted, writePersisted, clearPersisted } from '../lib/usePersistentState';
import { SkeletonCard } from '../components/Skeleton';
import ErrorNotice from '../components/ErrorNotice';

const EMPTY_DRAFT = { title: '', description: '', steps: '' };
const draftIsEmpty = (d) => !d || (!d.title?.trim() && !d.description?.trim() && !d.steps?.trim());
const draftKey = (uid) => `bugReport.${uid}`;

// Admin-only: the live queue of everything sitting in "pending", with
// Resolve/Dismiss buttons -- same shape as RequestFeature's ReviewPanel.
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
    getPendingBugReports()
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
  const decide = (report, resolve) => {
    const index = pending.findIndex((r) => r.id === report.id);
    runOptimistic({
      apply: () => setPending((cur) => cur.filter((r) => r.id !== report.id)),
      commit: () => (resolve ? resolveBugReport(report.id) : dismissBugReport(report.id)),
      rollback: () =>
        setPending((cur) => {
          if (cur.some((r) => r.id === report.id)) return cur;
          const next = [...cur];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, report);
          return next;
        }),
      toast,
      errorMessage: friendlyError(null, `Couldn't ${resolve ? 'resolve' : 'dismiss'} "${report.title}", so it's back in the queue.`),
      retry: () => decide(report, resolve),
    });
  };

  if (loading) {
    return (
      <div role="status" aria-live="polite">
        <span className="visually-hidden">Loading pending bug reports…</span>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    );
  }
  if (loadError) {
    return (
      <ErrorNotice
        message={friendlyError(loadError, "We couldn't load the pending bug reports. Try again.")}
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
          <p className="screen-subtitle" style={{ marginTop: -6 }}>Reported by {r.userName}</p>
          <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{r.description}</p>
          {r.steps && (
            <p className="screen-subtitle" style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>
              <strong>Steps to reproduce: </strong>
              {r.steps}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-success btn-tight" onClick={() => decide(r, true)}>
              {'\u{2713}'} Resolve
            </button>
            <button type="button" className="btn btn-danger btn-tight" onClick={() => decide(r, false)}>
              {'\u{2715}'} Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// The form everyone sees: name, description, and steps to reproduce --
// exactly what gets read on the other side.
// The draft is saved on this device as you type (per account), so leaving
// mid-sentence doesn't cost you the report; it's cleared once it's in.
function ReportForm({ user, onSubmit }) {
  const key = draftKey(user.uid);
  // Read once, before the hook below starts writing, to tell a restored
  // draft apart from one typed this visit.
  const [restored, setRestored] = useState(() => !draftIsEmpty(readPersisted(key)));
  const [draft, setDraft, clearDraft] = usePersistentState(key, EMPTY_DRAFT, { isEmpty: draftIsEmpty });
  const { title, description, steps } = { ...EMPTY_DRAFT, ...draft };
  const set = (field) => (e) => setDraft((cur) => ({ ...EMPTY_DRAFT, ...cur, [field]: e.target.value }));

  const canSubmit = title.trim() && description.trim();

  const submit = () => {
    if (!canSubmit) return;
    // Flush now -- the debounced save won't get to run once this form
    // unmounts for the "Thanks!" card, and a failed send restores from here.
    writePersisted(key, { title, description, steps });
    onSubmit({ title, description, steps });
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
        Something broken or not working right? Report it here — we read every single one.
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
        <label htmlFor="br-title">What's broken?</label>
        <input
          id="br-title"
          name="bug-title"
          type="text"
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="next"
          maxLength={80}
          value={title}
          onChange={set('title')}
          placeholder="e.g. Map pins don't load on the Itinerary tab"
        />
      </div>

      <div className="field">
        <label htmlFor="br-description">What happened?</label>
        <textarea
          id="br-description"
          name="bug-description"
          autoComplete="off"
          autoCapitalize="sentences"
          rows={3}
          maxLength={1000}
          value={description}
          onChange={set('description')}
          placeholder="What did you see, and what did you expect instead?"
        />
      </div>

      <div className="field">
        <label htmlFor="br-steps">Steps to reproduce (optional)</label>
        <textarea
          id="br-steps"
          name="bug-steps"
          autoComplete="off"
          autoCapitalize="sentences"
          rows={3}
          maxLength={1000}
          value={steps}
          onChange={set('steps')}
          placeholder="What did you tap, in what order, to make it happen?"
        />
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
        Submit Report
      </button>
    </form>
  );
}

export default function ReportBug() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, firebaseEnabled } = useAuth();
  const { myUsername } = useFriends();
  const admin = isAdmin(user?.email);
  // A tap on the "new bug report" notification lands the admin straight on
  // the review tab instead of the form.
  const [tab, setTab] = useState(admin && location.state?.tab === 'review' ? 'review' : 'report');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const toast = useToast();

  // Optimistic: "Thanks!" shows right away and the write runs behind it. If
  // it fails, the form comes back with everything still filled in (the
  // draft was flushed to storage on submit) and a Retry toast.
  const submitReport = (values) =>
    runOptimistic({
      apply: () => setJustSubmitted(true),
      commit: async () => {
        await submitBugReport({
          userId: user.uid,
          userName: myUsername || user.displayName || user.email || 'Explorer',
          ...values,
        });
        clearPersisted(draftKey(user.uid));
      },
      rollback: () => setJustSubmitted(false),
      toast,
      errorMessage: friendlyError(null, "Your report didn't send. It's still filled in — try again."),
      retry: () => submitReport(values),
    });

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => goBack(navigate, location)} style={{ marginBottom: 16 }}>
        {'← Back'}
      </button>

      <h1 className="screen-title">
        <span>{'\u{1F41B}'}</span> Report a Bug
      </h1>

      {admin && (
        <div className="tabs" style={{ margin: '0 0 16px' }}>
          <button type="button" className={`tab-btn ${tab === 'report' ? 'active' : ''}`} aria-pressed={!!(tab === 'report')} onClick={() => setTab('report')}>
            Report a Bug
          </button>
          <button type="button" className={`tab-btn ${tab === 'review' ? 'active' : ''}`} aria-pressed={!!(tab === 'review')} onClick={() => setTab('review')}>
            Resolve/Dismiss Reports
          </button>
        </div>
      )}

      {!firebaseEnabled ? (
        <p className="screen-subtitle">Accounts aren't set up yet.</p>
      ) : !user ? (
        <p className="screen-subtitle">Sign in first (Profile tab) to report a bug.</p>
      ) : tab === 'review' ? (
        <ReviewPanel />
      ) : justSubmitted ? (
        <div className="card section" style={{ textAlign: 'center' }}>
          <h3 style={{ marginTop: 0 }}>{'\u{1F41B}'} Thanks!</h3>
          <p className="screen-subtitle" style={{ margin: 0 }}>Your report is in — we read every one.</p>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setJustSubmitted(false)}>
            Report another
          </button>
        </div>
      ) : (
        <ReportForm user={user} onSubmit={submitReport} />
      )}
    </div>
  );
}
