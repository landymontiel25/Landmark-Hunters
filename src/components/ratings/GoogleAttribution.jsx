import { useImageAvailable } from './useImageAvailable';
import { GOOGLE_MAPS_LOGO_ON_DARK, GOOGLE_MAPS_LOGO_ON_LIGHT } from './brand';

// Google Maps attribution, as Google's Places policies require when Places
// content is shown without a Google map. The official Google Maps logo
// (16-19 px tall, labelled "Google Maps", never altered) once its files are
// in public/brand/; until then the text "Google Maps": exact wording, never
// translated or wrapped, sans-serif weight 400, 12-16 px. The theme picks
// which logo shows (styles/theme.css).
export default function GoogleAttribution({ className = '' }) {
  const dark = useImageAvailable(GOOGLE_MAPS_LOGO_ON_DARK);
  const light = useImageAvailable(GOOGLE_MAPS_LOGO_ON_LIGHT);
  if (dark === 'ok' && light === 'ok') {
    return (
      <span className={`gmp-logo ${className}`} role="img" aria-label="Google Maps" translate="no">
        <img src={GOOGLE_MAPS_LOGO_ON_DARK} alt="" className="gmp-logo-on-dark" />
        <img src={GOOGLE_MAPS_LOGO_ON_LIGHT} alt="" className="gmp-logo-on-light" />
      </span>
    );
  }
  return (
    <span className={`gmp-attribution ${className}`} translate="no">
      Google Maps
    </span>
  );
}
