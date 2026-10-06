import { SIMILAR_LIMIT } from '../../lib/nearbyPicks';
import { usePickVotes } from '../../lib/usePickVotes';
import { useReadyItems } from './useNearbyPicks';
import { useShownEffect } from './useShownEffect';
import PickCard from './PickCard';
import PickVoteButtons from '../PickVoteButtons';

// "Because you liked X": up to four places like one the user loved
// (nearbyPicks.similarPlaces). Hidden when nothing similar is ready. Signed
// in, each card asks "Would you go?" with the same Not for me / Not sure /
// I'd go buttons as Mapr Travel Picks; "Not for me" takes the card out.
export default function BecauseYouLikedRow({ liked, places, limit = SIMILAR_LIMIT, uid = null, origin = null, onShown = null }) {
  const ready = useReadyItems(places, limit);
  const { votes, removed, vote, retry } = usePickVotes({ uid, origin });
  const shown = ready.filter((p) => !removed.has(p.id));
  useShownEffect(liked ? onShown : null, shown);
  if (!liked || !shown.length) return null;
  return (
    <section className="mpp-section">
      <h3 className="mpp-section-title">Because you liked {liked.name}</h3>
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
