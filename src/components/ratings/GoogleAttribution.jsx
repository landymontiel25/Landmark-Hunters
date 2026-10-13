// "Google Maps" text attribution, as Google's Places policies require when
// Places content is shown without a Google map: exact wording, never
// translated or wrapped, sans-serif weight 400, 12-16 px.
export default function GoogleAttribution({ className = '' }) {
  return (
    <span className={`gmp-attribution ${className}`} translate="no">
      Google Maps
    </span>
  );
}
