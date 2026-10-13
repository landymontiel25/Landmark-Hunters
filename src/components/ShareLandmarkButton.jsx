import { useToast } from '../lib/ToastContext';
import { landmarkShareText, landmarkShareUrl } from '../lib/landmarkShare';

// The universal share icon: a box with an arrow coming up out of it.
export function ShareIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10.5H6.5A1.5 1.5 0 0 0 5 12v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5H16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Share on any place: the phone's share sheet (texts, WhatsApp, email...),
// or the text copied where there is none. Works for people without the app.
// `icon` shows just the share icon (place cards, a place's page).
export default function ShareLandmarkButton({ landmark, regionId, icon = false, className, children }) {
  const toast = useToast();
  const share = async (e) => {
    e?.stopPropagation?.();
    const text = landmarkShareText(landmark, regionId);
    const url = landmarkShareUrl(regionId, landmark.id);
    try {
      if (navigator.share) await navigator.share({ title: landmark.name, text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        toast?.show('Copied. Paste it in a text, email or anywhere.', { tone: 'success' });
      }
    } catch (err) {
      if (err?.name !== 'AbortError') toast?.show(`Couldn't share from here. The link: ${url}`);
    }
  };
  return (
    <button
      type="button"
      className={className || (icon ? 'share-icon-btn' : 'btn btn-ghost btn-tight')}
      onClick={share}
      aria-label={`Share ${landmark.name}`}
      title="Share"
    >
      {icon ? <ShareIcon /> : children || <>{'\u{1F4E4}'} Share</>}
    </button>
  );
}
