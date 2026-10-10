// Test tab only (screens/MallLab.jsx): an example strip mall to try "places
// with stores inside them" before any real mall goes in. Made-up stores, no
// map position, never part of the live catalog. The real Palm Grove Plaza has
// about 40 stores; six are enough to test with.
//
// A place with a `parentId` is a store inside that place; a place other
// places point to is a mall (lib/malls.js isMall). `tags` are what a thumbs
// up or down on the store moves in the user's taste. `visits` stands in for
// how often people go in (the real version counts check-ins).
export const PALM_GROVE_PLAZA = {
  id: 'palm-grove-plaza',
  name: 'Palm Grove Plaza',
  city: 'Miami, FL',
  kind: 'strip mall',
};

export const PALM_GROVE_STORES = [
  { id: 'page-turner-books', parentId: 'palm-grove-plaza', name: 'Page Turner Books', tags: ['books', 'quiet'], visits: 60 },
  { id: 'sunrise-coffee', parentId: 'palm-grove-plaza', name: 'Sunrise Coffee', tags: ['coffee', 'cafe'], visits: 120 },
  { id: 'fit-zone-gym', parentId: 'palm-grove-plaza', name: 'Fit Zone Gym', tags: ['fitness'], visits: 80 },
  { id: 'tropical-tacos', parentId: 'palm-grove-plaza', name: 'Tropical Tacos', tags: ['food', 'casual'], visits: 95 },
  { id: 'pet-pals-supply', parentId: 'palm-grove-plaza', name: 'Pet Pals Supply', tags: ['pets'], visits: 40 },
  { id: 'glow-nail-studio', parentId: 'palm-grove-plaza', name: 'Glow Nail Studio', tags: ['beauty'], visits: 35 },
];

export const TEST_MALL_PLACES = [PALM_GROVE_PLAZA, ...PALM_GROVE_STORES];
