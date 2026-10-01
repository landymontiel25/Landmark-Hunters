import { REQUEST_FOR_VALUES } from './maprConstants.js';

// Who a Mapr request is for. Asked before every request; 'group' requests
// follow what the user asked for and never use their own taste to choose.
export const isRequestFor = (v) => REQUEST_FOR_VALUES.includes(v);
export const normalizeRequestFor = (v) => (isRequestFor(v) ? v : 'solo');

// The taste fields of the plan-ai payload. Solo: as given. Group: every
// field that carries the user's taste is emptied, so none of it leaves the
// device. (api/plan-ai.js drops them again on its side.)
export function tasteContextFor(requestFor, ctx) {
  if (requestFor === 'group') {
    return { reviews: [], interests: [], tasteIntro: '', insiderMode: false, tagScoreSummary: {} };
  }
  return {
    reviews: ctx.reviews,
    interests: ctx.interests,
    tasteIntro: ctx.tasteIntro,
    insiderMode: ctx.insiderMode,
    tagScoreSummary: ctx.tagScoreSummary,
  };
}
