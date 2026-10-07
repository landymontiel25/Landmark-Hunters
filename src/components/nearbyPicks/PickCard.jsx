import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useUnits, formatDistance } from '../../lib/UnitsContext';
import { categoryLabel } from '../../lib/nearbyPicks';
import { primaryCategory } from '../../lib/preferenceChains';
import { iconFor, paletteFor } from '../../lib/landmarkVisuals';
import DirectionsButton from '../DirectionsButton';
import { usePlacePhoto } from '../../lib/usePlacePhoto';
import PlacePhotoCredit from '../PlacePhotoCredit';

// One pick: photo, name, distance, one-line reason, Directions. Tapping a
// card or a row opens a small sheet with Directions and the landmark's own
// page (the same /landmarks/:region/:id page a map pin's popup opens).
//
// showChainLabel: the small "which link produced this" label -- off by
// default, so the Map tab never shows it.
export function PickTag({ pick }) {
  if (pick.favorite) return <span className="mpp-tag mpp-tag-fav">{(pick.favoriteStars || 0) >= 5 ? 'You loved this' : 'A favorite of yours'}</span>;
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

// The place's photo, or -- with none in its data, or a broken one -- the
// same colored category tile LandmarkThumb falls back to.
export function PickPhoto({ pick, className }) {
  const [failed, setFailed] = useState(null);
  const place = usePlacePhoto(pick, { enabled: !pick.image || failed === pick.image });
  if (pick.image && failed !== pick.image) {
    return <img className={className} src={pick.image} alt="" loading="lazy" decoding="async" onError={() => setFailed(pick.image)} />;
  }
  if (place.photo) {
    return (
      <span className={`${className} place-photo-host`}>
        <img src={place.photo.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={place.onError} />
        <PlacePhotoCredit photo={place.photo} compact />
      </span>
    );
  }
  const [from, to] = paletteFor(pick.id);
  return (
    <span ref={place.ref} className={`${className} mpp-img-tile`} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }} aria-hidden="true">
      {iconFor(pick.categories)}
    </span>
  );
}

// Tap a pick: Directions (the app's usual Get Directions sheet) or the
// landmark's page.
export function PickActionsSheet({ pick, onClose }) {
  const navigate = useNavigate();
  const close = (e) => {
    e?.stopPropagation?.();
    onClose();
  };
  return createPortal(
    <div className="modal-backdrop" onClick={close}>
      <div className="modal-card directions-sheet" role="dialog" aria-label={pick.name} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{pick.name}</h3>
        {/* "Open in Map" navigates to the Map tab, which is where this sheet
            already is -- without closing it here it stayed up over the route. */}
        <DirectionsButton
          name={pick.name}
          lat={pick.lat}
          lng={pick.lng}
          className="btn btn-primary btn-block directions-choice"
          onInApp={() => {
            onClose();
            navigate('/', { state: { directionsTo: { name: pick.name, lat: pick.lat, lng: pick.lng } } });
          }}
        >
          {'\u{1F9ED}'} Directions
        </DirectionsButton>
        <button
          type="button"
          className="btn btn-primary btn-block directions-choice"
          onClick={(e) => {
            close(e);
            navigate(`/landmarks/${pick.region}/${pick.id}`);
          }}
        >
          {'\u{1F4CD}'} Open landmark page
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={close}>
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}

function usePickActions(pick) {
  const [open, setOpen] = useState(false);
  return {
    openActions: () => setOpen(true),
    sheet: open ? <PickActionsSheet pick={pick} onClose={() => setOpen(false)} /> : null,
  };
}

export default function PickCard({ pick, showChainLabel = false, showTag = true, voteSlot = null }) {
  const { units } = useUnits();
  const { openActions, sheet } = usePickActions(pick);
  return (
    <article className="mpp-card" data-pick={`${pick.region}/${pick.id}`}>
      <button type="button" className="mpp-card-main" onClick={openActions} aria-haspopup="dialog">
        <PickPhoto pick={pick} className="mpp-card-img" />
        <span className="mpp-card-body">
          <span className="mpp-card-tags">
            {showTag && pick.pickType && <PickTag pick={pick} />}
            {showChainLabel && <ChainLabel chain={pick.chain} />}
          </span>
          <span className="mpp-card-name">{pick.name}</span>
          <span className="mpp-card-meta">
            {pick.distanceMeters != null && formatDistance(pick.distanceMeters, units)}
            {pick.distanceMeters != null && ' · '}
            {categoryLabel(primaryCategory(pick.categories))}
            {pick.rating?.count ? ` · ${'\u{2605}'} ${Number(pick.rating.avg).toFixed(1)}` : ''}
          </span>
          {pick.reason && <span className="mpp-card-reason">{pick.reason}</span>}
        </span>
      </button>
      <div className="mpp-card-foot">
        <DirectionsButton name={pick.name} lat={pick.lat} lng={pick.lng} className="btn btn-ghost btn-sm mpp-card-dir">
          {'\u{1F9ED}'} Directions
        </DirectionsButton>
      </div>
      {voteSlot}
      {sheet}
    </article>
  );
}

// Compact row for the collapsed bottom sheet's top three (and the meal card).
export function PickRow({ pick, action = null, voteSlot = null }) {
  const { units } = useUnits();
  const { openActions, sheet } = usePickActions(pick);
  return (
    <li className="mpp-row" data-pick={`${pick.region}/${pick.id}`}>
      <button type="button" className="mpp-row-main" onClick={openActions} aria-haspopup="dialog">
        <PickPhoto pick={pick} className="mpp-row-img" />
        <span className="mpp-row-body">
          <strong>{pick.name}</strong>
          <span>
            {pick.distanceMeters != null ? formatDistance(pick.distanceMeters, units) : ''}
            {pick.favorite ? ' · You loved this' : pick.pickType === 'new' ? ' · Something new' : ''}
          </span>
        </span>
      </button>
      {action}
      {voteSlot}
      {sheet}
    </li>
  );
}
