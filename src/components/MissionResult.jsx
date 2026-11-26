// The trivia mission's result (owner, 2026-11-25): after answering and
// tapping Done, the check-in sheet shows whether the answer was right and
// what the right answer is, and stays until Done is tapped again. Your pick
// is green when right, red when wrong; the right answer is green. The right
// answer comes from the server only after the one answer (missionAnswer.js).
export default function MissionResult({ mission, result, onDone }) {
  const options = mission?.options || [];
  const right = Number.isInteger(result?.answer) ? result.answer : null;
  const picked = result?.picked;
  return (
    <section className="mission-panel mission-result-screen" aria-label="Mission result">
      <h3 className="mission-result-title" role="status">
        {result?.correct ? `${'✓'} You got it right` : 'Not this time'}
      </h3>
      <p className="mission-result-points">{result?.correct ? `+${result.awarded ?? 10} points.` : 'No points this time. One answer per place.'}</p>
      {mission?.question && <p className="mission-question">{mission.question}</p>}
      <div className="mission-options" role="list">
        {options.map((o, i) => {
          const state = i === picked ? (result?.correct ? ' is-right' : ' is-wrong') : i === right ? ' is-right' : '';
          return (
            <div key={i} role="listitem" className={`mission-option${state}`}>
              {o}
              {i === picked && <span className="mission-option-tag">{result?.correct ? ' (your answer, right)' : ' (your answer)'}</span>}
              {i === right && i !== picked && <span className="mission-option-tag"> (right answer)</span>}
            </div>
          );
        })}
      </div>
      {right !== null && (
        <p className="mission-result-answer">
          The answer: <strong>{options[right]}</strong>
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={onDone}>
        Done
      </button>
    </section>
  );
}
