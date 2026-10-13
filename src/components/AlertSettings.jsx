import { useEffect, useState } from 'react';
import { ALERT_GROUPS, ALERT_GROUP_IDS, alertOn } from '../lib/alerts';
import { getAlertPrefs, setAlertPref } from '../lib/alertPrefs';

// Settings → Discovery alerts (Phase 5): one switch per group. Pushes also
// need Push Notifications on; in-app alerts show in Notifications either way.
export default function AlertSettings({ uid, toast = null }) {
  const [prefs, setPrefs] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getAlertPrefs(uid)
      .then((p) => !cancelled && setPrefs(p))
      .catch(() => !cancelled && setPrefs({}));
    return () => {
      cancelled = true;
    };
  }, [uid]);
  if (!prefs) return null;
  // The switch shows what you chose at once; if the save fails it goes
  // back to what it was before this tap.
  const toggle = async (group) => {
    const before = alertOn(prefs, group);
    const next = !before;
    setPrefs((p) => ({ ...p, [group]: next }));
    try {
      await setAlertPref(uid, group, next);
    } catch {
      setPrefs((p) => (p[group] === next ? { ...p, [group]: before } : p));
      toast?.show?.("Couldn't save that. Try again.");
    }
  };
  return (
    <div className="card section">
      <h3 style={{ marginTop: 0 }}>{'\u{1F9ED}'} Discovery alerts</h3>
      <p className="screen-subtitle" style={{ marginTop: 0 }}>
        About your tips, the people you follow and finds near you.
      </p>
      {ALERT_GROUP_IDS.map((g) => {
        const on = alertOn(prefs, g);
        return (
          <label key={g} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={on} onChange={() => toggle(g)} style={{ marginTop: 3 }} />
            <span>
              {ALERT_GROUPS[g].label}
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                {ALERT_GROUPS[g].help}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
