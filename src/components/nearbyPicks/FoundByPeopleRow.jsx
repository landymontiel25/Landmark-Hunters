import { FOUND_ROW_MIN } from '../../lib/communityLabels';
import { SIMILAR_LIMIT } from '../../lib/nearbyPicks';
import { usePickVotes } from '../../lib/usePickVotes';
import { useReadyItems } from './useNearbyPicks';
import { useShownEffect } from './useShownEffect';
import PickCard from './PickCard';
import PickVoteButtons from '../PickVoteButtons';

// "Found by people like you" (Phase 3): places in range with a live tip
// from a taste neighbor, someone you follow or a friend, in Mapr's order.
// Shows only when 3 or more qualify. Each card says who found it.
export default function FoundByPeopleRow({ places, limit = SIMILAR_LIMIT, uid = null, origin = null, onShown = null }) {
  const ready = useReadyItems(places, limit);
  const { votes, removed, vote, retry } = usePickVotes({ uid, origin });
  const shown = ready.filter((p) => !removed.has(p.id));
  // 3 or more, counted on what's still on screen ("Not for me" takes one out).
  const enough = shown.length >= FOUND_ROW_MIN;
  useShownEffect(enough ? onShown : null, shown);
  if (!enough) return null;
  return (
    <section className="mpp-section">
      <h3 className="mpp-section-title">Found by people like you</h3>
      <div className="mpp-carousel">
        {shown.map((p) => (
          <PickCard
            key={`${p.region}/${p.id}`}
            pick={p}
            showTag={false}
            voteSlot={
              uid ? (
                <PickVoteButtons
                  name={p.name}
                  vote={votes[p.id]}
                  onVote={(v) => vote({ id: p.id, region: p.region, name: p.name, categories: p.categories || [] }, v)}
                  onRetry={() => retry(p.id)}
                />
              ) : null
            }
          />
        ))}
      </div>
    </section>
  );
}
