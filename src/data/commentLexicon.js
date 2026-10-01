// Words and phrases Mapr reads in a rating's comment (src/lib/commentSignals.js).
// Deterministic, no AI. Extend it by adding an entry; nothing else changes.
//
// Each entry:
//   id       unique name, only for tests and debugging
//   terms    lowercase words or phrases (apostrophes as ' ; matched on word
//            boundaries; a phrase may span several words)
//   tags     the existing tag ids (INTERESTS in src/data/regions.js) the
//            comment is about, or 'self' = the tags of the place being rated
//   valence  +1 praise (raises the tags), -1 complaint (lowers them)
//
// Negation is handled by the matcher, not here: "not loud" cancels the
// complaint; "not good" turns praise into a (weaker) complaint.
//
// A complaint about an aspect lowers the KINDS of places that aspect belongs
// to (loud -> nightlife, shows, stadiums), so list every tag that fits.
export const COMMENT_LEXICON = [
  // --- complaints about an aspect -----------------------------------------
  { id: 'loud', terms: ['loud', 'too loud', 'noisy', 'too noisy', 'deafening', 'blaring'], tags: ['local-life', 'entertainment', 'stadiums'], valence: -1 },
  { id: 'crowded', terms: ['crowded', 'too crowded', 'packed', 'overcrowded', 'too many people', 'long lines', 'long line'], tags: ['entertainment', 'local-life', 'stadiums'], valence: -1 },
  { id: 'touristy', terms: ['touristy', 'tourist trap', 'overrated'], tags: ['self'], valence: -1 },
  { id: 'pricey', terms: ['overpriced', 'too expensive', 'expensive', 'rip off', 'ripoff', 'not worth the price'], tags: ['food', 'entertainment', 'local-life'], valence: -1 },
  { id: 'bad-food', terms: ['bad food', 'terrible food', 'awful food', 'bland', 'cold food', 'greasy', 'tasteless', 'food was bad', 'food was terrible'], tags: ['food'], valence: -1 },
  { id: 'slow-service', terms: ['slow service', 'rude staff', 'rude waiter', 'bad service', 'terrible service', 'long wait'], tags: ['food', 'local-life'], valence: -1 },
  { id: 'dirty', terms: ['dirty', 'filthy', 'smelly', 'trash everywhere', 'unclean'], tags: ['self'], valence: -1 },
  { id: 'boring', terms: ['boring', 'dull', 'nothing to see', 'not interesting', 'uninteresting', 'meh', 'disappointing', 'disappointed', 'waste of time', 'waste of money'], tags: ['self'], valence: -1 },
  { id: 'unsafe', terms: ['unsafe', 'sketchy', 'dangerous', 'felt unsafe'], tags: ['self'], valence: -1 },
  { id: 'small', terms: ['too small', 'tiny', 'cramped'], tags: ['self'], valence: -1 },
  { id: 'nature-complaint', terms: ['too hot', 'too muddy', 'overgrown', 'buggy', 'mosquitoes'], tags: ['parks-nature'], valence: -1 },
  { id: 'dated-museum', terms: ['stuffy', 'outdated exhibits', 'dusty'], tags: ['art-museums', 'history-culture'], valence: -1 },

  // --- praise for an aspect ------------------------------------------------
  { id: 'great-food', terms: ['great food', 'amazing food', 'delicious', 'tasty', 'yummy', 'best food', 'incredible food', 'excellent food', 'good food', 'fresh food', 'mouthwatering', 'food was great', 'food was amazing'], tags: ['food'], valence: 1 },
  { id: 'great-drinks', terms: ['great cocktails', 'amazing cocktails', 'great drinks', 'great music', 'great atmosphere', 'great vibe', 'amazing vibe', 'great nightlife', 'fun crowd'], tags: ['local-life'], valence: 1 },
  { id: 'great-show', terms: ['great show', 'amazing show', 'so fun', 'a blast', 'great for kids', 'kids loved'], tags: ['entertainment'], valence: 1 },
  { id: 'great-game', terms: ['great game', 'amazing game', 'electric atmosphere', 'great seats'], tags: ['stadiums', 'sports'], valence: 1 },
  { id: 'beautiful-nature', terms: ['beautiful views', 'great views', 'amazing views', 'peaceful', 'serene', 'gorgeous scenery', 'relaxing', 'beautiful trail', 'beautiful park', 'great hike'], tags: ['parks-nature'], valence: 1 },
  { id: 'history', terms: ['fascinating history', 'so much history', 'rich history', 'learned a lot', 'beautiful architecture', 'great history', 'historic'], tags: ['history-culture'], valence: 1 },
  { id: 'art', terms: ['great exhibit', 'amazing exhibit', 'beautiful art', 'great collection', 'amazing art', 'inspiring art'], tags: ['art-museums'], valence: 1 },
  { id: 'tech', terms: ['great innovation', 'inspiring tech', 'cool tech', 'startup energy'], tags: ['tech'], valence: 1 },

  // --- general sentiment about the place itself ---------------------------
  { id: 'love-it', terms: ['loved it', 'love it', 'love this place', 'amazing', 'awesome', 'fantastic', 'wonderful', 'incredible', 'must see', 'must visit', 'must go', 'highly recommend', 'worth it', 'worth the trip', 'favorite', 'favourite', 'will be back', 'would go again', 'hidden gem', 'perfect'], tags: ['self'], valence: 1 },
  { id: 'hate-it', terms: ['hated it', 'hate it', 'awful', 'terrible', 'horrible', 'worst', 'never again', 'would not go again', 'wouldnt go again', 'not worth it', 'skip it', 'avoid'], tags: ['self'], valence: -1 },
];
