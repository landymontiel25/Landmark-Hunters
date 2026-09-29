import { useUnits, formatDistance } from '../../lib/UnitsContext';
import { categoryLabel } from '../../lib/nearbyPicks';
import { primaryCategory } from '../../lib/preferenceChains';
import DirectionsButton from '../DirectionsButton';

// One pick: photo, name, distance, one-line reason, Directions. Only ever
// rendered for a pick whose photo has already loaded (see composePicks /
// useReadyItems), so there is no loading state here on purpose.
//
// showChainLabel: the small "which link produced this" label -- preview
// only, off by default so the real tabs never show it.
export function PickTag({ pick }) {
  if (pick.pickType === 'new') return <span className="mpp-tag mpp-tag-new">Something new</span>;
  return <span className="mpp-tag mpp-tag-usual">Your usual</span>;
}

export function ChainLabel({ chain }) {
  if (!chain) return null;
  return (
    <span className="mpp-chain" title={`Checked in to ${categoryLabel(chain.from)} then ${categoryLabel(chain.to)} back to back ${chain.count} times`}>
      {'\u{1F517}'} {categoryLabel(chain.from)} {'\u{2192}'} {categoryLabel(chain.to)} ({chain.count}{'\u{00D7}'})
    </span>
  );
}

export default function PickCard({ pick, showChainLabel = false, showTag = true }) {
  const { units } = useUnits();
  return (
    <article className="mpp-card" data-pick={`${pick.region}/${pick.id}`}>
      <img className="mpp-card-img" src={pick.image} alt="" />
      <div className="mpp-card-body">
        <div className="mpp-card-tags">
          {showTag && pick.pickType && <PickTag pick={pick} />}
          {showChainLabel && <ChainLabel chain={pick.chain} />}
        </div>
        <h4 className="mpp-card-name">{pick.name}</h4>
        <p className="mpp-card-meta">
          {pick.distanceMeters != null && formatDistance(pick.distanceMeters, units)}
          {pick.distanceMeters != null && ' · '}
          {categoryLabel(primaryCategory(pick.categories))}
          {pick.rating?.count ? ` · ${'\u{2605}'} ${Number(pick.rating.avg).toFixed(1)}` : ''}
        </p>
        {pick.reason && <p className="mpp-card-reason">{pick.reason}</p>}
        <DirectionsButton name={pick.name} lat={pick.lat} lng={pick.lng} className="btn btn-ghost btn-sm mpp-card-dir">
          {'\u{1F9ED}'} Directions
        </DirectionsButton>
      </div>
    </article>
  );
}

// Compact row for the collapsed bottom sheet's top three.
export function PickRow({ pick, action = null }) {
  const { units } = useUnits();
  return (
    <li className="mpp-row" data-pick={`${pick.region}/${pick.id}`}>
      <img className="mpp-row-img" src={pick.image} alt="" />
      <div className="mpp-row-body">
        <strong>{pick.name}</strong>
        <span>
          {pick.distanceMeters != null ? formatDistance(pick.distanceMeters, units) : ''}
          {pick.pickType === 'new' ? ' · Something new' : ''}
        </span>
      </div>
      {action}
    </li>
  );
}
