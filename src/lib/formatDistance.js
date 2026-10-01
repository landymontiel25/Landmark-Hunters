// Shared by UnitsContext (re-exported there) and the pure picks code.
export function formatDistance(meters, units) {
  if (units === 'imperial') {
    const feet = meters * 3.28084;
    // Compare the ROUNDED value so 999.6 ft reads "0.2 mi", not "1000 ft".
    return Math.round(feet) < 1000 ? `${Math.round(feet)} ft` : `${(meters / 1609.34).toFixed(1)} mi`;
  }
  return Math.round(meters) < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}
