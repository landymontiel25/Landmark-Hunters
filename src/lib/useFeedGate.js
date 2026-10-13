import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { useTrip } from './TripContext';
import { canonicalRegionId } from '../data/regions';
import { COMMUNITY_REGIONS } from './community';
import { fetchFeedGate } from './feedApi';

// The city the Feed is for, when that city is past the density gate
// (Phase 6): your current trip's city, if it is a launch city whose gate is
// open. Null everywhere else (the Map stays home); undefined while the
// gate is still loading.
export function useFeedCity() {
  const { user } = useAuth();
  const { trip } = useTrip();
  const region = trip?.activeRegion ? canonicalRegionId(trip.activeRegion) : null;
  const launch = !!user?.uid && !!region && COMMUNITY_REGIONS.includes(region);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (!launch) return undefined;
    let cancelled = false;
    fetchFeedGate().then((o) => !cancelled && setOpen(o));
    return () => {
      cancelled = true;
    };
  }, [launch, user?.uid, region]);
  if (!launch) return null;
  if (open == null) return undefined;
  return open[region] === true ? region : null;
}
