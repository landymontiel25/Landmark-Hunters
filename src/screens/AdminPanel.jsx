import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useAdminMode } from '../lib/AdminModeContext';
import { useToast } from '../lib/ToastContext';
import { API_BASE } from '../lib/apiBase';
import { authHeaders } from '../lib/apiAuth';
import { restartOnboardingAsNew } from '../lib/onboardingSave';
import { subscribeAnnouncement, setAnnouncement, clearAnnouncement, ANNOUNCEMENT_MAX } from '../lib/announcement';
import { friendlyError } from '../lib/friendlyError';

// The admin panel (owner, 2026-11-23): everything the admin account can do,
// full screen, from Admin Mode in the account menu or Settings. Only that
// account can open it (others are sent home), and every control is checked
// again on the server or in firestore.rules.
//   Edit tools           the existing Admin Mode (edit any landmark)
//   Check-in radius off  this account only (admin_settings/{uid})
//   Test notification    a push to this account's own devices
//   Preview as new user  onboarding from the top; points and check-ins stay
//   Announcement banner  the message everyone sees at the top of the app

const PUSH_REASONS = {
  disabled: 'Push notifications are off for this account. Turn them on in Settings, then try again.',
  'no-devices': "This account has no device registered for push yet. Open the app on your phone and allow notifications.",
  'not-configured': "Push isn't set up on the server.",
  'all-failed': "Sent, but every device turned it down. Reopen the app on your phone so it registers again.",
  'send-failed': "Couldn't reach the push service. Try again.",
  'firestore-error': "Couldn't read your devices. Try again.",
};

function Switch({ label, detail, checked, onChange, disabled }) {
  return (
    <div className="admin-row">
      <div className="admin-row-text">
        <p className="admin-row-title">{label}</p>
        {detail && <p className="admin-row-detail">{detail}</p>}
      </div>
      <label className="admin-mode-switch admin-row-switch">
        <span className="visually-hidden">{label}</span>
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="admin-mode-switch-track" aria-hidden="true" />
      </label>
    </div>
  );
}

export default function AdminPanel() {
  const { user, loading } = useAuth();
  const { canUseAdminMode, adminMode, setAdminMode, checkinAnywhere, setCheckinAnywhere } = useAdminMode();
  const toast = useToast();
  const navigate = useNavigate();
  const [pushState, setPushState] = useState({ busy: false, note: null });
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [current, setCurrent] = useState('');
  const [draft, setDraft] = useState(null);
  const [savingBanner, setSavingBanner] = useState(false);

  useEffect(() => subscribeAnnouncement(setCurrent), []);
  // Full screen: the header and tab bar step aside while the panel is open.
  useEffect(() => {
    document.body.classList.add('admin-panel-open');
    return () => document.body.classList.remove('admin-panel-open');
  }, []);

  if (loading) return null;
  if (!user || !canUseAdminMode) return <Navigate to="/" replace />;

  const text = draft ?? current;

  const sendTestPush = async () => {
    setPushState({ busy: true, note: null });
    try {
      const r = await fetch(`${API_BASE}/api/admin-test-push`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) } });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw Object.assign(new Error(data?.error || 'Failed'), { userMessage: data?.error || "Couldn't send it. Try again." });
      setPushState({
        busy: false,
        note: data.sent > 0 ? `Sent to ${data.sent} device${data.sent === 1 ? '' : 's'}. It's in your notifications too.` : PUSH_REASONS[data.reason] || "Nothing was sent. Try again.",
      });
    } catch (e) {
      setPushState({ busy: false, note: friendlyError(e, "Couldn't send it. Try again.") });
    }
  };

  const previewAsNew = async () => {
    setResetting(true);
    try {
      await restartOnboardingAsNew(user.uid);
      navigate('/profile');
    } catch (e) {
      toast.show(friendlyError(e, "Couldn't restart onboarding. Try again."));
      setResetting(false);
    }
  };

  const saveBanner = async (value) => {
    setSavingBanner(true);
    try {
      if (value) await setAnnouncement(value);
      else await clearAnnouncement();
      setDraft(null);
      toast.show(value ? 'The banner is live for everyone.' : 'The banner is cleared.', { tone: 'success', durationMs: 2500 });
    } catch (e) {
      toast.show(friendlyError(e, "Couldn't save the banner. Try again."));
    } finally {
      setSavingBanner(false);
    }
  };

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
          {'\u{2190}'} Back
        </button>
      </div>
      <p className="nl-label">Admin</p>
      <h1 className="screen-title">Admin Mode</h1>
      <p className="screen-subtitle">Only your account sees this. Every switch here affects your account only, except the banner.</p>

      <section className="admin-section" aria-label="Switches">
        <Switch
          label="Edit tools"
          detail="Edit or delete any landmark from its page or map pin. Changes are for everyone."
          checked={adminMode}
          onChange={setAdminMode}
        />
        <Switch
          label="Check-in radius off"
          detail="Check in from anywhere. Your account only; everyone else still has to be there."
          checked={checkinAnywhere}
          onChange={(on) =>
            setCheckinAnywhere(on).catch((e) => toast.show(friendlyError(e, "Couldn't save that. Try again.")))
          }
        />
      </section>

      <section className="admin-section" aria-label="Notifications">
        <div className="admin-row admin-row-stack">
          <div className="admin-row-text">
            <p className="admin-row-title">Send myself a test notification</p>
            <p className="admin-row-detail">A push to your own devices only.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-block" disabled={pushState.busy} onClick={sendTestPush}>
            {pushState.busy ? 'Sending…' : 'Send test notification'}
          </button>
          {pushState.note && (
            <p className="admin-row-detail" role="status">
              {pushState.note}
            </p>
          )}
        </div>
      </section>

      <section className="admin-section" aria-label="Onboarding">
        <div className="admin-row admin-row-stack">
          <div className="admin-row-text">
            <p className="admin-row-title">Preview as a brand new user</p>
            <p className="admin-row-detail">Starts onboarding from the beginning for your account. Your points, check-ins and ratings stay.</p>
          </div>
          {confirmReset ? (
            <div className="admin-row-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)} disabled={resetting}>
                Cancel
              </button>
              <button type="button" className="btn btn-ghost" onClick={previewAsNew} disabled={resetting}>
                {resetting ? 'Starting…' : 'Start onboarding'}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setConfirmReset(true)}>
              Preview as a new user
            </button>
          )}
        </div>
      </section>

      <section className="admin-section" aria-label="Announcement banner">
        <div className="admin-row admin-row-stack">
          <div className="admin-row-text">
            <p className="admin-row-title">Announcement banner</p>
            <p className="admin-row-detail">{current ? 'Live for everyone now.' : 'No banner showing.'}</p>
          </div>
          <textarea
            className="rating-comment admin-banner-input"
            aria-label="Banner message"
            rows={3}
            maxLength={ANNOUNCEMENT_MAX}
            placeholder="Write the message everyone sees at the top of the app"
            value={text}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="admin-row-detail">
            {text.length}/{ANNOUNCEMENT_MAX}
          </p>
          <div className="admin-row-actions">
            <button type="button" className="btn btn-ghost" disabled={savingBanner || !current} onClick={() => saveBanner('')}>
              Clear banner
            </button>
            <button type="button" className="btn btn-primary" disabled={savingBanner || !text.trim() || text.trim() === current} onClick={() => saveBanner(text)}>
              {savingBanner ? 'Saving…' : 'Show banner'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
