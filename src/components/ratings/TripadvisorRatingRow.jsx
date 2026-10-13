import { formatCount } from '../../lib/ratingSources';
import { TRIPADVISOR_LOGO } from './brand';

// Tripadvisor's rules: its logo to the left of the bubble rating it sends
// (never our own icons), bubbles on white, a link back to Tripadvisor, and
// quotes only from 5-bubble reviews (the server already filters those) in
// quotation marks, with the date and "Tripadvisor traveler review".
export function TripadvisorMark({ data, compact = false }) {
  return (
    <span className={`ta-mark ${compact ? 'ta-mark-compact' : ''}`}>
      <img src={TRIPADVISOR_LOGO} alt="Tripadvisor" className="ta-logo" />
      {data.ratingImageUrl ? (
        <img src={data.ratingImageUrl} alt={`${data.rating.toFixed(1)} of 5 bubbles`} className="ta-bubbles" />
      ) : (
        <span className="ratings-score">{data.rating.toFixed(1)}</span>
      )}
    </span>
  );
}

export default function TripadvisorRatingRow({ data }) {
  return (
    <div className="ratings-row ratings-row-tripadvisor" data-source="tripadvisor">
      <div className="ratings-row-head">
        <TripadvisorMark data={data} />
        <span className="ratings-count">({formatCount(data.count)} reviews)</span>
      </div>
      {data.snippets?.length > 0 && (
        <ul className="ratings-snippets">
          {data.snippets.map((s, i) => (
            <li key={i} className="ratings-snippet">
              {s.ratingImageUrl && <img src={s.ratingImageUrl} alt="5 of 5 bubbles" className="ta-bubbles ta-bubbles-small" />}
              <q className="ratings-quote">{s.text}</q>
              <span className="ratings-when">
                Tripadvisor traveler review{s.author ? ` by ${s.author}` : ''}, {s.date}.{' '}
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  Read more
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
      <a className="ratings-see-all" href={data.url} target="_blank" rel="noopener noreferrer">
        See reviews
      </a>
    </div>
  );
}
