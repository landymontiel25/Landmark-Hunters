import { useState } from 'react';

// Test tab: "5 images". Five pictures that explain what a new user is about
// to do in onboarding, shown one at a time with Back / Next and dots. The
// files live in public/explainer/1.webp to 5.webp; a missing one shows an
// empty slot so the click-through still works before the art lands.
export const EXPLAINER_IMAGES = [1, 2, 3, 4, 5].map((n) => `/explainer/${n}.webp`);

export default function ExplainerImagesLab() {
  const [index, setIndex] = useState(0);
  const [missing, setMissing] = useState({});
  const last = EXPLAINER_IMAGES.length - 1;
  const src = EXPLAINER_IMAGES[index];

  return (
    <div className="card section explainer-lab">
      <h2 className="section-title">5 images</h2>
      <div className="explainer-frame">
        {missing[src] ? (
          <div className="explainer-empty">Image {index + 1}</div>
        ) : (
          <img key={src} src={src} alt={`Onboarding image ${index + 1} of ${EXPLAINER_IMAGES.length}`} onError={() => setMissing((m) => ({ ...m, [src]: true }))} />
        )}
      </div>
      <div className="explainer-dots" role="tablist" aria-label="Images">
        {EXPLAINER_IMAGES.map((s, i) => (
          <button key={s} type="button" role="tab" aria-selected={i === index} aria-label={`Image ${i + 1}`} className={`explainer-dot${i === index ? ' on' : ''}`} onClick={() => setIndex(i)} />
        ))}
      </div>
      <div className="explainer-nav">
        <button type="button" className="btn btn-secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          Back
        </button>
        <span className="explainer-count">
          {index + 1} / {EXPLAINER_IMAGES.length}
        </span>
        <button type="button" className="btn btn-primary" disabled={index === last} onClick={() => setIndex(index + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
