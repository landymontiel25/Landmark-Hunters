import { useMemo, useState } from 'react';
import DATA from '../data/miamiNeighborhoods.json';
import { useGeo } from '../lib/GeoContext';
import {
  DEFAULT_CHIP,
  RATING_ROWS,
  RESTAURANT_ROWS,
  TOP_TABS,
  chipsFor,
  exploreSummary,
  formatScore,
  overallScore,
  ratingValue,
  scoreBand,
  tagLine,
  visibleNeighborhoods,
} from '../lib/neighborhoods';
import './Neighborhoods.css';

// The Landmarks tab's Neighborhoods subtab (owner, 2026-11-06). Browse
// Miami's neighborhoods by Popular / Nearby / All areas, narrow them with a
// chip, and open one for its ratings. Neighborhoods have no check-ins and no
// landmark data. Ratings are null until a separate pipeline fills them.

// A photo, or a dark tile with the first letter when there is none (or it
// fails to load). Photos are Wikimedia Commons files (credits in the data).
function CardPhoto({ n, score }) {
  const [failed, setFailed] = useState(false);
  const showPhoto = n.photo && !failed;
  return (
    <div className="nb-photo">
      {showPhoto ? (
        <img src={n.photo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <div className="nb-photo-empty" data-testid="nb-placeholder" aria-hidden="true">
          {n.name.charAt(0)}
        </div>
      )}
      <span className={`nb-score-badge band-${scoreBand(score)}`} aria-label={`Overall score ${formatScore(score)}`}>
        {formatScore(score)}
      </span>
    </div>
  );
}

export function NeighborhoodCard({ n, onOpen }) {
  const score = overallScore(n.ratings);
  const sub = tagLine(n);
  return (
    <button type="button" className="nb-card" onClick={() => onOpen(n)} aria-label={`Open ${n.name}`}>
      <CardPhoto n={n} score={score} />
      <span className="nb-card-name">{n.name}</span>
      <span className="nb-card-sub">{sub || ' '}</span>
    </button>
  );
}

// One read-only rating: a 0-5 number line with ticks, filled from 0 to the
// score in its band color. Null: empty track and "–".
export function RatingSlider({ label, value, comingSoon = false, sub = false, children }) {
  const band = scoreBand(value);
  const pct = value == null ? 0 : Math.max(0, Math.min(5, value)) * 20;
  return (
    <div className={`nb-slider ${sub ? 'sub' : ''}`} role="group" aria-label={label}>
      <div className="nb-slider-head">
        <span className="nb-slider-label">{label}</span>
        {children}
        <span className="nb-slider-value">{comingSoon ? 'Coming soon' : formatScore(value)}</span>
      </div>
      <div className="nb-track" aria-hidden="true">
        {value != null && !comingSoon && <div className={`nb-fill band-${band}`} data-testid="nb-fill" style={{ width: `${pct}%` }} />}
        {[0, 1, 2, 3, 4, 5].map((t) => (
          <span key={t} className="nb-tick" style={{ left: `${t * 20}%` }} />
        ))}
      </div>
      <div className="nb-tick-labels" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((t) => (
          <span key={t} style={{ left: `${t * 20}%` }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export function NeighborhoodDetail({ n, onBack }) {
  const [openRestaurants, setOpenRestaurants] = useState(false);
  const score = overallScore(n.ratings);
  const info = (n.info || '').trim();
  return (
    <div className="nb-detail">
      <button type="button" className="btn btn-ghost btn-sm nb-back" onClick={onBack}>
        {'‹'} Back
      </button>
      <h2 className="nb-detail-title">
        <span>{n.name}</span> <span className={`nb-detail-score band-${scoreBand(score)}`}>{formatScore(score)}</span>
      </h2>
      {info && <p className="nb-detail-info">{info}</p>}
      <div className="nb-sliders">
        {RATING_ROWS.map((r) =>
          r.key === 'restaurants' ? (
            <div key={r.key}>
              <RatingSlider label={r.label} value={ratingValue(n.ratings, r.key)}>
                <button
                  type="button"
                  className={`nb-expand ${openRestaurants ? 'open' : ''}`}
                  aria-expanded={openRestaurants}
                  aria-label={`${openRestaurants ? 'Hide' : 'Show'} restaurant details`}
                  onClick={() => setOpenRestaurants((v) => !v)}
                >
                  <span className="nb-chevron" aria-hidden="true" />
                </button>
              </RatingSlider>
              {openRestaurants && (
                <div className="nb-sub-sliders">
                  {RESTAURANT_ROWS.map((s) => (
                    <RatingSlider key={s.key} sub label={s.label} value={s.comingSoon ? null : n.ratings?.restaurants?.[s.key] ?? null} comingSoon={s.comingSoon} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <RatingSlider key={r.key} label={r.label} value={ratingValue(n.ratings, r.key)} />
          )
        )}
      </div>
      {n.photoCredit && (
        <p className="nb-credit">
          Photo:{' '}
          <a href={n.photoCredit.source} target="_blank" rel="noreferrer">
            {n.photoCredit.author}
          </a>
          , {n.photoCredit.license}, via Wikimedia Commons
        </p>
      )}
    </div>
  );
}

function CardGrid({ items, onOpen }) {
  return (
    <div className="nb-grid">
      {items.map((n) => (
        <NeighborhoodCard key={n.name} n={n} onOpen={onOpen} />
      ))}
    </div>
  );
}

// The screen without the app's location context, so tests can hand it data
// and a location directly.
export function NeighborhoodsView({ data = DATA, coords = null, onUseLocation, locating = false }) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('popular');
  const [chipId, setChipId] = useState(DEFAULT_CHIP);
  const [open, setOpen] = useState(null);
  // Must-See is Popular's default. Nearby and All areas open on every
  // neighborhood (Must-See there would show the same four); tapping a lit
  // chip turns it off too.
  const pickTab = (id) => {
    setTab(id);
    setChipId(id === 'popular' ? DEFAULT_CHIP : null);
  };
  const chips = useMemo(() => chipsFor(data), [data]);
  const chip = chips.find((c) => c.id === chipId);
  const { items, groups, needsLocation } = useMemo(
    () => visibleNeighborhoods(data, { tab, chipId, search, coords }),
    [data, tab, chipId, search, coords]
  );

  if (open) return <NeighborhoodDetail n={open} onBack={() => setOpen(null)} />;

  const searching = !!search.trim();
  const city = data.city || 'Miami';
  const empty = needsLocation || items.length ? null : searching ? 'No neighborhoods match your search.' : 'No neighborhoods here yet.';

  return (
    <div className="nb">
      <p className="nb-eyebrow">LANDMARK HUNTERS {'·'} {city.toUpperCase()}</p>
      <h2 className="nb-title">Explore Neighborhoods</h2>
      <div className="nb-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          name="neighborhood-search"
          aria-label={`Search ${city} neighborhoods`}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={`Search ${city} neighborhoods...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="nb-tabs" role="tablist" aria-label="Neighborhood lists">
        {TOP_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`nb-tab ${tab === t.id ? 'on' : ''}`} onClick={() => pickTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="nb-chips-box">
        <div className="nb-chips" role="group" aria-label="Filters">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`nb-chip ${chipId === c.id ? 'on' : ''}`}
              aria-pressed={chipId === c.id}
              title={c.title ? `${c.label} · ${c.title}` : c.label}
              onClick={() => setChipId((cur) => (cur === c.id ? null : c.id))}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="nb-explore">
          Explore: {chip ? chip.label : 'All neighborhoods'}
          {chip?.title ? ` · ${chip.title}` : ''}
        </p>
        {!needsLocation && items.length > 0 && <p className="nb-explore-list" data-testid="nb-explore-list">{exploreSummary(items)}</p>}
      </div>

      {needsLocation && (
        <div className="nb-empty">
          <p>Turn on location to see neighborhoods near you.</p>
          {onUseLocation && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={locating} onClick={onUseLocation}>
              {locating ? 'Finding you…' : 'Use my location'}
            </button>
          )}
        </div>
      )}
      {empty && <p className="nb-empty">{empty}</p>}

      {tab === 'popular' && !empty && !needsLocation && <h3 className="nb-section">Start with {city}'s favorites</h3>}
      {groups
        ? groups.map((g) => (
            <section key={g.city} className="nb-group">
              <h3 className="nb-section">{g.city}</h3>
              <CardGrid items={g.items} onOpen={setOpen} />
            </section>
          ))
        : items.length > 0 && <CardGrid items={items} onOpen={setOpen} />}
    </div>
  );
}

// "Use my location" asks for a fresh fix only when tapped; the screen never
// asks on its own.
export default function Neighborhoods({ data = DATA }) {
  const { coords, refresh, refreshing } = useGeo();
  return <NeighborhoodsView data={data} coords={coords} onUseLocation={refresh} locating={refreshing} />;
}
