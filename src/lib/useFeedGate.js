import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { useTrip } from './TripContext';
import { canonicalRegionId } from '../data/regions';
import { COMMUNITY_REGIONS } from './community';
import { fetchFeedGate } from './feedApi';

// The city the Feed is for, when that city is past the density gate
// (Phase 6): your current trip's city, if it is a launch city whose gate is
// open. Null everywhere else, and the Map stays home.
export function useFeedCity() {
  const { user } = useAuth();
  const { trip } = useTrip();
  const region = trip?.activeRegion ? canonicalRegionId(trip.activeRegion) : null;
  const [open, setOpen] = useState({});
  useEffect(() => {
    if (!user?.uid || !region || !COMMUNITY_REGIONS.includes(region)) return undefined;
    let cancelled = false;
    fetchFeedGate().then((o) => !cancelled && setOpen(o));
    return () => {
      cancelled = true;
    };
  }, [user?.uid, region]);
  return region && open[region] === true ? region : null;
}
