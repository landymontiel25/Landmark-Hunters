import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Full-screen photo viewer: solid black, above everything (header and nav
// hidden), and the page behind it can't scroll while it's open. Tap the
// photo's surroundings or the ✕ to close.
export default function Lightbox({ src, alt = 'Photo', onClose }) {
  // A photo that can't load says so in words instead of a broken-image icon
  // on a black screen.
  const [failedSrc, setFailedSrc] = useState(null);
  // Held in a ref so a parent passing a fresh inline onClose each render
  // doesn't tear down and re-lock the page (and jump the scroll) every time.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Lock the page: iOS ignores overflow:hidden on body, so pin the body
  // in place at the current scroll offset and put it back on close.
  useEffect(() => {
    if (!src) return;
    const y = window.scrollY;
    const { position, top, width, overflow } = document.body.style;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${y}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('lightbox-open');
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current?.();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.position = position;
      document.body.style.top = top;
      document.body.style.width = width;
      document.body.style.overflow = overflow;
      document.body.classList.remove('lightbox-open');
      window.removeEventListener('keydown', onKey);
      window.scrollTo(0, y);
    };
  }, [src]);

  if (!src) return null;
  return createPortal(
    <div className="lightbox" onClick={onClose} onTouchMove={(e) => e.preventDefault()} role="dialog" aria-modal="true">
      {failedSrc === src ? (
        <p className="lightbox-error" role="alert">
          {'\u{1F4F7}'} This photo couldn't load. Check your connection and try again.
        </p>
      ) : (
        <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} onError={() => setFailedSrc(src)} />
      )}
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
        {'\u{2715}'}
      </button>
    </div>,
    document.body
  );
}
