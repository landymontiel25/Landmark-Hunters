import { useEffect, useState } from 'react';
import { subscribeAnnouncement } from '../lib/announcement';

// The announcement banner (owner, 2026-11-23): the message the admin sets in
// the admin panel, shown to everyone at the top of the app. The x hides that
// message on this device; a new message shows again.
const HIDDEN_KEY = 'lh.announcement.hidden';

export default function AnnouncementBanner() {
  const [message, setMessage] = useState('');
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) || '';
    } catch {
      return '';
    }
  });
  useEffect(() => subscribeAnnouncement(setMessage), []);
  if (!message || hidden === message) return null;
  const hide = () => {
    setHidden(message);
    try {
      localStorage.setItem(HIDDEN_KEY, message);
    } catch {
      /* private mode: hidden for this visit only */
    }
  };
  return (
    <div className="announcement-banner" role="status">
      <p className="announcement-banner-text">{message}</p>
      <button type="button" className="announcement-banner-hide" aria-label="Hide this announcement" onClick={hide}>
        <span aria-hidden="true">{'\u{00D7}'}</span>
      </button>
    </div>
  );
}
