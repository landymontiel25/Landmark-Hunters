import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { setBackgroundLocationEnabled } from '../lib/friends';
import { requestAlwaysPermission } from '../lib/backgroundLocation';
import { friendlyError } from '../lib/friendlyError';
import ErrorNotice from './ErrorNotice';

// Final onboarding step -- asks to upgrade from "When In Use" (already
// granted by now, since FirstCheckInStep just used GPS) to "Always", so Mapr
// can keep learning your taste and location even with the app closed (see
// src/lib/backgroundLocation.js). Comes last on purpose: this native
// permission dialog reads as a bigger ask than the others, so it only shows
// up once someone has already gotten value from the app. Skippable, and
// re-offered anytime from Settings.
export default function LocationAlwaysStep({ onDone }) {
  const { user } = useAuth();
  const [enabling, setEnabling] = useState(false);
  const [err, setErr] = useState(null);

  const enable = async () => {
    setEnabling(true);
    setErr(null);
    try {
      const authorized = await requestAlwaysPermission();
      if (!authorized) {
        setErr('Location access is off for Landmark Hunters. You can turn it on later from Settings or iOS Settings.');
        return;
      }
      await setBackgroundLocationEnabled(user.uid, true);
      onDone();
    } catch (e) {
      setErr(friendlyError(e, "Couldn't turn that on. You can enable it later from Settings."));
    } finally {
      setEnabling(false);
    }
  };

  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F30D}'}</span> Always Know Where You Are
      </h1>
      <p className="screen-subtitle">
        Turn this on and Mapr keeps learning even when the app is closed -- so the moment you land somewhere new,
        it's already building picks for that city instead of starting from scratch when you open the app.
      </p>
      {err && <ErrorNotice compact message={err} />}
      <button type="button" className="btn btn-primary btn-block" onClick={enable} disabled={enabling}>
        {enabling ? 'Enabling…' : 'Always Allow Location'}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onDone}>
        Not now
      </button>
    </div>
  );
}
