import { TURNED_OFF, REMOVED } from './plannerList';
import LandmarkSelection from './LandmarkSelection';

// Test tab "Planner launch" (owner, 2026-11-02; was "Planner"): the list of everything turned off
// for now, so nothing gets forgotten. The entries live in plannerList.js.
const REPO = 'https://github.com/landymontiel25/Landmark-Hunters/pull/';

export default function PlannerLab() {
  return (
    <div className="planner-lab">
      <h1 className="screen-title">
        <span>{'\u{1F5C2}\u{FE0F}'}</span> Planner launch
      </h1>
      <p className="screen-subtitle">Everything turned off for now. Each one is a switch in the code, so it can come back.</p>
      <ol className="planner-list">
        {TURNED_OFF.map((item) => (
          <li key={item.name} className="card section planner-item">
            <div className="planner-item-head">
              <strong>{item.name}</strong>
              <span className="tag">Off since {item.since}</span>
            </div>
            <p className="planner-hides">{item.hides}</p>
            <p className="planner-keeps">{item.keeps}</p>
            <p className="planner-where">
              <code>{item.check}</code> in <code>{item.file}</code> ·{' '}
              <a href={`${REPO}${item.pr}`} target="_blank" rel="noreferrer">
                #{item.pr}
              </a>
            </p>
          </li>
        ))}
      </ol>
      {REMOVED.length > 0 && (
        <>
          <h2 className="planner-subhead">Taken out (not a switch)</h2>
          <ul className="planner-list">
            {REMOVED.map((item) => (
              <li key={item.name} className="card section planner-item">
                <div className="planner-item-head">
                  <strong>{item.name}</strong>
                  <span className="tag">Removed {item.since}</span>
                </div>
                <p className="planner-hides">{item.what}</p>
                <p className="planner-where">
                  <a href={`${REPO}${item.pr}`} target="_blank" rel="noreferrer">
                    #{item.pr}
                  </a>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {/* For Me left the Landmarks tab (owner, 2026-11-06) and lives here,
          working as before: Mapr's ranking for you, with check-in and rating. */}
      <section className="planner-forme" aria-label="For Me">
        <h2 className="planner-subhead">For Me</h2>
        <LandmarkSelection forMeLab />
      </section>
    </div>
  );
}
