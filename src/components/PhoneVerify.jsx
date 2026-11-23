import { useEffect, useRef, useState } from 'react';
import { RecaptchaVerifier, linkWithPhoneNumber } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { friendlyError } from '../lib/friendlyError';

// Links a phone number to the signed-in account (Firebase phone sign-in),
// the proof a referral bonus needs (anti-farming item 3). Two steps: the
// number, then the 6-digit code the text message brings. `onDone` runs once
// the number is linked.
export default function PhoneVerify({ onDone }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('number'); // number | code
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const confirmation = useRef(null);
  const verifier = useRef(null);
  const boxId = useRef(`phone-captcha-${Math.random().toString(36).slice(2)}`);

  useEffect(
    () => () => {
      try {
        verifier.current?.clear();
      } catch {
        /* already gone */
      }
    },
    []
  );

  const send = async () => {
    const number = phone.replace(/[^\d+]/g, '');
    if (!/^\+\d{8,15}$/.test(number)) {
      setError('Enter your number with its country code, like +1 305 555 0100.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!verifier.current) verifier.current = new RecaptchaVerifier(auth, boxId.current, { size: 'invisible' });
      confirmation.current = await linkWithPhoneNumber(auth.currentUser, number, verifier.current);
      setStep('code');
    } catch (e) {
      setError(friendlyError(e, "Couldn't send the code. Check the number and try again."));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmation.current.confirm(code.trim());
      await auth.currentUser.getIdToken(true);
      onDone?.();
    } catch (e) {
      setError(friendlyError(e, "That code didn't work. Check it and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rf-phone">
      {step === 'number' ? (
        <>
          <label className="rf-phone-label" htmlFor={`${boxId.current}-n`}>
            Your phone number
          </label>
          <input
            id={`${boxId.current}-n`}
            className="rf-phone-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 305 555 0100"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={send}>
            {busy ? 'Sending…' : 'Text me a code'}
          </button>
        </>
      ) : (
        <>
          <label className="rf-phone-label" htmlFor={`${boxId.current}-c`}>
            The 6-digit code
          </label>
          <input
            id={`${boxId.current}-c`}
            className="rf-phone-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="button" className="rf-btn rf-btn-primary" disabled={busy || code.trim().length < 6} onClick={confirm}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
        </>
      )}
      {error && (
        <p className="rf-phone-error" role="alert">
          {error}
        </p>
      )}
      <div id={boxId.current} />
    </div>
  );
}
