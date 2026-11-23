import { useEffect, useState } from 'react';
import { REFERRAL_BONUS_POINTS, countMyReferrals, referralLink, claimMyReferralBonuses, referralNeed } from '../lib/referrals';
import PhoneVerify from './PhoneVerify';

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
  // Joined through a friend's link: what the server still needs before it
  // pays you both (a verified phone, then a verified check-in).
  const [need, setNeed] = useState(null);
  const recheck = () => claimMyReferralBonuses(uid).then((r) => setNeed(referralNeed(r)));
  useEffect(() => {
    if (!uid) return;
    claimMyReferralBonuses(uid).then((r) => setNeed(referralNeed(r)));
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
        You and your friend each get {REFERRAL_BONUS_POINTS} points once they sign up with your link, verify their phone number and check in somewhere.
      </p>
      <div className="rf-link" data-testid="rf-link">{url.replace(/^https:\/\//, '')}</div>
      <div className="rf-actions">
        <button type="button" className="rf-btn rf-btn-primary" onClick={share}>Share invite</button>
        <button type="button" className="rf-btn" onClick={copy} aria-live="polite">{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      {need === 'phone' && (
        <div className="rf-need">
          <p className="rf-sub">You joined with a friend&apos;s link. Verify your phone number to unlock {REFERRAL_BONUS_POINTS} points for each of you.</p>
          <PhoneVerify onDone={recheck} />
        </div>
      )}
      {need === 'checkin' && <p className="rf-sub rf-need">Check in at any place to unlock your {REFERRAL_BONUS_POINTS} points, and your friend&apos;s.</p>}
      {need === 'phone-used' && <p className="rf-sub rf-need">That phone number already unlocked a referral bonus.</p>}
      {joined > 0 && (
        <p className="rf-count">
          {joined} {joined === 1 ? 'friend has' : 'friends have'} joined with your link.
        </p>
      )}
    </section>
  );
}
