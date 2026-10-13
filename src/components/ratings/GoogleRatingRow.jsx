import { formatReviews } from '../../lib/ratingSources';
import GoogleAttribution from './GoogleAttribution';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// One source row in the detail screen's Ratings section. Google's rules for
// reviews: name, photo and profile link of each author; a link to the review
// on Google Maps; a note on how reviews are ordered; the visit date for
// places in France (Google sends it only then).
export default function GoogleRatingRow({ data }) {
  return (
    <div className="ratings-row ratings-row-google" data-source="google">
      <div className="ratings-row-head">
        <GoogleAttribution />
        <span className="ratings-score">
          <span className="ratings-star" aria-hidden="true">
            {'★'}
          </span>
          {data.rating.toFixed(1)}
        </span>
        <span className="ratings-count">({formatReviews(data.count)})</span>
      </div>
      {data.snippets?.length > 0 && (
        <>
          <ul className="ratings-snippets">
            {data.snippets.map((s, i) => (
              <li key={i} className="ratings-snippet">
                <a className="ratings-author" href={s.authorUrl || s.url} target="_blank" rel="noopener noreferrer">
                  {s.authorPhotoUrl && <img src={s.authorPhotoUrl} alt="" className="ratings-avatar" referrerPolicy="no-referrer" />}
                  <span>{s.author}</span>
                </a>
                {s.when && <span className="ratings-when"> · {s.when}</span>}
                <q className="ratings-quote">{s.text}</q>
                {s.visitDate && (
                  <span className="ratings-when">
                    Visited {s.visitDate.month ? `${MONTHS[s.visitDate.month - 1]} ` : ''}
                    {s.visitDate.year}
                  </span>
                )}
                {s.translated && <span className="ratings-when"> Translated by Google.</span>}
                <a className="ratings-review-link" href={s.url} target="_blank" rel="noopener noreferrer">
                  Read on Google Maps
                </a>
              </li>
            ))}
          </ul>
          <p className="ratings-note">
            Most relevant reviews, as ordered by Google. Google doesn't verify reviews.{' '}
            <a href="https://support.google.com/contributionpolicy/answer/7422880" target="_blank" rel="noopener noreferrer">
              Learn more
            </a>
          </p>
        </>
      )}
      <a className="ratings-see-all" href={data.url} target="_blank" rel="noopener noreferrer">
        See reviews
      </a>
    </div>
  );
}
