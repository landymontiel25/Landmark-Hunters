// "Free" / "Needs a ticket" pill. The `free` field means no admission ticket
// is required (src/data: free:false is a ticketed attraction). Restaurants
// and cafes carry a price level instead and are never "ticketed", so they
// show nothing rather than a misleading "Ticketed".
export function admissionText(landmark, short = false) {
  if (!landmark) return null;
  // Unknown (imported places without a fee tag): no claim either way.
  if (landmark.free == null) return null;
  if (landmark.free) return short ? 'Free' : 'Free to Visit';
  if ((landmark.categories || []).includes('food')) return null;
  return 'Needs a ticket';
}

export default function AdmissionTag({ landmark, short = false }) {
  const text = admissionText(landmark, short);
  if (!text) return null;
  return <span className={`tag ${landmark.free ? 'tag-free' : ''}`}>{text}</span>;
}
