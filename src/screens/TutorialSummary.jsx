import { INTERESTS } from '../data/regions';
import { tagDeltasFromAnswers, tasteIntroFromAnswers, SWIPE_DELTAS, PLACE_DELTA } from '../lib/onboardingCards';

// The results screen at the end of a tutorial run: what a real signup would
// have saved (tagScores changes, the cards, notes, what Mapr reads), and the
// run's log. Nothing here was saved. Tutorial and Ultimate tutorial both
// end on it; `chips` (Ultimate's taste picks) and `showPlaces` (Tutorial's
// "Your places" step) add or drop their lines.
export default function LabSummary({ data, log, onRestart, showPlaces = true }) {
  const tagLabel = (id) => INTERESTS.find((i) => i.id === id)?.label || id;
  const deltas = tagDeltasFromAnswers(data.answers, data.places);
  const intro = tasteIntroFromAnswers(data.answers, data.notes, data.places);
  const count = (a) => data.answers.filter((x) => x.answer === a).length;
  const answerLabel = { love: 'love it', dislike: "don't like it", unsure: 'not sure' };
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F3C1}'}</span> Tutorial finished
      </h1>
      <p className="screen-subtitle">What a real signup would have saved. Nothing here was actually saved.</p>
      <div className="card section">
        <p>
          <strong>Signed up with:</strong> {data.via || '—'}
        </p>
        {data.skippedRating ? (
          <p>
            <strong>Cards:</strong> skipped, no preference data yet
          </p>
        ) : (
          <p>
            <strong>Cards:</strong> {data.answers.length} of {data.cards.length} rated — {count('love')} love it,{' '}
            {count('dislike')} don't like it, {count('unsure')} not sure
          </p>
        )}
        {data.chips && (
          <p>
            <strong>Taste picks:</strong> {data.chips.length ? data.chips.map(tagLabel).join(', ') : 'skipped'}
          </p>
        )}
        {showPlaces && (
          <p>
            <strong>Places you visit most:</strong> {data.places.length ? data.places.map((l) => l.name).join(', ') : 'none'}
          </p>
        )}
        <p>
          <strong>First check-in:</strong> {data.checkedIn ? 'yes' : 'skipped'}
        </p>
      </div>

      {!data.skippedRating && (
        <>
          <div className="card section">
            <strong>tagScores changes</strong>
            <p className="screen-subtitle" style={{ margin: '4px 0 8px' }}>
              Love it {SWIPE_DELTAS.love > 0 ? '+' : ''}
              {SWIPE_DELTAS.love}, don't like it {SWIPE_DELTAS.dislike}, not sure 0, each place you visit most{' '}
              {PLACE_DELTA > 0 ? '+' : ''}
              {PLACE_DELTA} on each of its tags — summed per tag.
            </p>
            {Object.keys(deltas).length ? (
              <ul className="lab-log">
                {Object.entries(deltas)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tag, d]) => (
                    <li key={tag}>
                      {tagLabel(tag)} <code>{tag}</code>: {d > 0 ? '+' : ''}
                      {d}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="screen-subtitle">No changes (nothing loved or disliked).</p>
            )}
          </div>

          <div className="card section">
            <strong>Each card</strong>
            <ul className="lab-log">
              {data.answers.map(({ card, answer }) => (
                <li key={card.word}>
                  {card.icon} {card.word} → {answerLabel[answer]} <code>{card.tag}</code>{' '}
                  {card.photoPages.map((href, i) => (
                    <a key={href} href={href} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>
                      photo{card.photoPages.length > 1 ? ` ${i + 1}` : ''}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          </div>

          <div className="card section">
            <strong>What Mapr reads</strong>
            <p className="screen-subtitle" style={{ margin: '4px 0 0' }}>
              {intro || 'nothing'}
            </p>
            <p className="screen-subtitle" style={{ fontSize: '0.75rem' }}>
              The same text goes to every Mapr surface: the Map sheet, chat, the trip planner and the landmark list.
            </p>
          </div>

          <div className="card section">
            <strong>Onboarding notes</strong>
            <p className="screen-subtitle" style={{ margin: '4px 0 0' }}>
              {data.notes.trim() ? `"${data.notes.trim()}"` : 'none'}
            </p>
            <p className="screen-subtitle" style={{ fontSize: '0.75rem' }}>
              Kept as raw text and passed to Mapr as context, never turned into new tags.
            </p>
          </div>
        </>
      )}

      {log.length > 0 && (
        <div className="card section">
          <strong>What happened</strong>
          <ol className="lab-log">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={onRestart}>
        {'\u{21BA}'} Restart
      </button>
    </div>
  );
}
