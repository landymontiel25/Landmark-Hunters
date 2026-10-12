// The mall lab's checks (Test tab, screens/MallLab.jsx), also run by
// mallChecks.test.js. Each returns { name, pass, detail } on made-up users,
// so they never touch a real account.
import { PALM_GROVE_PLAZA, TEST_MALL_PLACES } from '../data/testMalls.js';
import { applyStoreVote, childrenOf, isMall, mallForItinerary, mallScore, ratingQueue, storesByVisits, makeStoreRating } from './malls.js';

const EMPTY_TASTE = { scores: {}, at: {}, counts: {} };
const store = (id) => TEST_MALL_PLACES.find((p) => p.id === id);
// A made-up user who has liked the given stores `times` times each.
function likedUser(storeIds, times = 3) {
  let taste = EMPTY_TASTE;
  const now = Date.now();
  for (let i = 0; i < times; i++) for (const id of storeIds) taste = applyStoreVote(taste, store(id), 'up', now);
  return taste;
}

export function runMallChecks() {
  const mallId = PALM_GROVE_PLAZA.id;
  const checks = [];

  const stores = childrenOf(mallId, TEST_MALL_PLACES);
  checks.push({
    name: 'Palm Grove Plaza loads with all 6 stores',
    pass: stores.length === 6 && isMall(PALM_GROVE_PLAZA, TEST_MALL_PLACES) && stores.every((s) => s.parentId === mallId),
    detail: `${stores.length} stores: ${storesByVisits(mallId, TEST_MALL_PLACES).map((s) => s.name).join(', ')}`,
  });

  const after = applyStoreVote(EMPTY_TASTE, store('sunrise-coffee'), 'up');
  checks.push({
    name: 'A thumbs up on Sunrise Coffee raises "coffee" and "cafe"',
    pass: after.scores.coffee > 0 && after.scores.cafe > 0 && Object.keys(after.scores).length === 2,
    detail: `coffee 0 → ${after.scores.coffee}, cafe 0 → ${after.scores.cafe}`,
  });

  const five = stores.slice(0, 5).map((s) => s.id);
  const queue = ratingQueue(five, TEST_MALL_PLACES);
  checks.push({
    name: 'Checking 5 stores in one visit stops at 4 rating cards',
    pass: queue.length === 4,
    detail: `5 checked, ${queue.length} cards`,
  });

  const ratings = [
    makeStoreRating({ userId: 'test-a', store: store('sunrise-coffee'), vote: 'up' }),
    makeStoreRating({ userId: 'test-b', store: store('sunrise-coffee'), vote: 'up' }),
    makeStoreRating({ userId: 'test-a', store: store('pet-pals-supply'), vote: 'down' }),
  ];
  // Only Sunrise Coffee (120 visits, 2 of 2 up) and Pet Pals (40 visits, 0 of 1 up) are rated:
  // (1 * 120 + 0 * 40) / (120 + 40) = 0.75. Counting the four unrated stores as 0 would give less.
  const score = mallScore(mallId, TEST_MALL_PLACES, ratings);
  checks.push({
    name: 'The mall score ignores unrated stores',
    pass: Math.abs(score - 0.75) < 1e-9,
    detail: `${Math.round(score * 100)}% thumbs up from 2 rated stores (4 unrated skipped), weighted by visits`,
  });

  const coffeeBooks = mallForItinerary(mallId, TEST_MALL_PLACES, likedUser(['sunrise-coffee', 'page-turner-books']).scores);
  checks.push({
    name: 'A coffee and books lover sees Palm Grove in an itinerary, with both stores as the reason',
    pass: coffeeBooks.include && coffeeBooks.stores.length === 2 && /Sunrise Coffee/.test(coffeeBooks.reason) && /Page Turner Books/.test(coffeeBooks.reason),
    detail: coffeeBooks.reason || 'not included',
  });

  const pets = mallForItinerary(mallId, TEST_MALL_PLACES, likedUser(['pet-pals-supply']).scores);
  checks.push({
    name: 'A pets-only user does not see Palm Grove (only 1 store matches)',
    pass: !pets.include && pets.stores.length === 1,
    detail: `${pets.stores.length} matching store${pets.stores.length === 1 ? '' : 's'}: ${pets.stores.map((s) => s.name).join(', ') || 'none'}`,
  });

  return checks;
}
