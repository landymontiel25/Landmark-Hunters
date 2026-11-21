import { useEffect, useState } from 'react';
import { REFERRAL_BONUS_POINTS, countMyReferrals, referralLink } from '../lib/referrals';

// Profile's invite card: your link, Share and Copy, and how many friends
// signed up through it.
export default function ReferralCard({ uid, myUsername }) {
  const [copied, setCopied] = useState(false);
  const [counts, setCounts] = useState(null);
  const url = referralLink(myUsername);
  const text = myUsername
    ? `I'm on Landmark Hunters. Come join me! My name is ${myUsername}.`
    : `I'm on Landmark Hunters. Come join me!`;

  useEffect(() => {
    let live = true;
    if (!uid) return undefined;
    countMyReferrals(uid).then((c) => live && setCounts(c));
    return () => {
      live = false;
    };
  }, [uid]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked */
    }
  };
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Landmark Hunters', text, url });
        return;
      }
    } catch {
      /* cancelled the share sheet; do not also copy */
      return;
    }
    copy();
  };

  const joined = counts?.joined || 0;
  return (
    <section className="rf-card" aria-label="Invite friends">
      <h2 className="rf-title">Invite friends</h2>
      <p className="rf-sub">
        You and your friend each get {REFERRAL_BONUS_POINTS} points when they sign up with your link and verify their email.
      </p>
      <div className="rf-link" data-testid="rf-link">{url.replace(/^https:\/\//, '')}</div>
      <div className="rf-actions">
        <button type="button" className="rf-btn rf-btn-primary" onClick={share}>Share invite</button>
        <button type="button" className="rf-btn" onClick={copy} aria-live="polite">{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      {joined > 0 && (
        <p className="rf-count">
          {joined} {joined === 1 ? 'friend has' : 'friends have'} joined with your link.
        </p>
      )}
    </section>
  );
}
