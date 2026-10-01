import { useCallback, useEffect, useRef, useState } from 'react';
import DisagreementPrompt from '../components/DisagreementPrompt';
import { previewDisagreement } from './reviews';

// For a screen that saves a rating: `await ask({ userId, landmark, tier, comment })`
// before submitReview. Resolves to undefined when no question is due (a
// one-level change, a first rating, or a comment that already says why), else
// to { reason, comment } once the user answers or skips. Render `node`
// somewhere in the screen. Never throws: if the check fails, no question.
export function useDisagreementAsk() {
  const [req, setReq] = useState(null);
  const pending = useRef(null);

  const ask = useCallback(async ({ userId, landmark, tier, comment }) => {
    let preview;
    try {
      preview = await previewDisagreement({ userId, landmark, tier, comment });
    } catch {
      return undefined;
    }
    if (!preview?.needsAsk) return undefined;
    return new Promise((resolve) => {
      pending.current = resolve;
      setReq({ landmarkName: landmark.name });
    });
  }, []);

  const answer = useCallback((a) => {
    const resolve = pending.current;
    pending.current = null;
    setReq(null);
    resolve?.(a);
  }, []);

  // Leaving the screen mid-question answers it as Skip so a save never hangs.
  useEffect(
    () => () => {
      pending.current?.({ reason: 'skip', comment: '' });
      pending.current = null;
    },
    []
  );

  const node = req ? <DisagreementPrompt landmarkName={req.landmarkName} onAnswer={answer} /> : null;
  return { ask, node };
}
