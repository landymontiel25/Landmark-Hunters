// A person's picture in a squircle, or their gold initial when they have
// none (owner, 2026-11-14). `url` is users/{uid}.avatarURL.
import { useState } from 'react';

export default function UserAvatar({ url, initial = '?', className = '' }) {
  const [broken, setBroken] = useState(null);
  const show = url && broken !== url;
  return (
    <span className={`user-avatar ${show ? 'has-photo' : ''} ${className}`.trim()} aria-hidden="true">
      {show ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(url)} /> : initial}
    </span>
  );
}
