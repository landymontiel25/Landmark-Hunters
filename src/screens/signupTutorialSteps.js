// Everything Mapr says in the Test tab's Tutorial (screens/OnboardingLab),
// the sign-up tutorial and onboarding combined into one flow. Edit the
// words here. `say` is a list: one Mapr bubble per line.

// The steps, in order. `label` is the step's button in the test controls.
export const TUTORIAL_STEPS = [
  { id: 'hello', label: 'Hello' },
  { id: 'signup', label: 'Sign up' },
  { id: 'verify', label: 'Verify email' },
  { id: 'howto', label: 'Swipe practice' },
  { id: 'cards', label: 'Cards' },
  { id: 'notes', label: 'Anything else' },
  { id: 'places', label: 'Your places' },
  { id: 'checkin', label: 'First check-in' },
  { id: 'location', label: 'Location' },
  { id: 'tabs', label: 'Your tabs' },
  { id: 'done', label: 'Done' },
];

export const SAY = {
  hello: [
    "Hi! I'm Mapr, your personal AI guide.",
    "I'll help you sign up, learn what you like, and show you around the app. It only takes a couple of minutes.",
  ],
  signup: ['First, make your account. Add a name, your email and a password, or tap Sign up with Google.'],
  verify: [
    'I sent you an email with a link. Tap it, then come back here.',
    "This is the one step you can't skip.",
  ],
  howtoIntro: [
    "Now I'll show you some cards so I can learn what you like.",
    "Let's practice first. You can swipe or tap, and I'll show you both.",
  ],
  howtoReady: ["You've got it! \u{1F389} Now the real cards. There are no wrong answers."],
  cards: ['This takes a minute max. Every card teaches me what to pick for you.'],
  notes: ["Anything else you love or hate that the cards didn't cover? Tell me in your own words, or skip it."],
  places: ['Which places do you go to most? Add a few and I can find new spots like them.'],
  checkin: ["If you're at a landmark right now, check in for your first points. Not near one? Skip for now."],
  location: [
    'In the iPhone app I ask to switch location from While Using to Always.',
    'That lets me tell you when you pass a place worth a stop. You can skip this too.',
  ],
  done: ["That's it! Go find your first landmark. I'll be here when you need me."],
};

// Swipe practice (step 4), one card per task. `how` is the way the card has
// to be answered: 'swipe' (drag the card), 'tap' (tap the card itself) or
// 'button' (the ✕ − ♥ buttons under it). `good` is what Mapr says when you
// get it right.
const practice = (word, icon, group) => ({ word, icon, group, photos: [], tag: null });
export const PRACTICE = [
  {
    card: practice('Ice cream', '\u{1F366}', 'food'),
    want: 'love',
    how: 'swipe',
    ask: 'Swipe the Ice cream card right.',
    good: 'Good job! Swiping right means you loved it.',
  },
  {
    card: practice('Traffic jams', '\u{1F697}', 'local'),
    want: 'dislike',
    how: 'swipe',
    ask: 'Now swipe the Traffic jams card left.',
    good: "Good job! Swiping left means you didn't like it.",
  },
  {
    card: practice('Opera', '\u{1F3AD}', 'entertainment'),
    want: 'unsure',
    how: 'tap',
    ask: 'Now tap the Opera card.',
    good: "Good job! Tapping the card means you're not sure.",
  },
  {
    card: practice('Beaches', '\u{1F3D6}\u{FE0F}', 'nature'),
    want: 'love',
    how: 'button',
    ask: 'You can tap the buttons too. Tap \u{2665} under the Beaches card.',
    good: 'Good job! \u{2665} means you loved it, same as swiping right.',
  },
];

// The "Your tabs" step: one stop per tab (`path` is the tab's real screen,
// shown in the drawn phone), in the bottom bar's order. `live` lets you use
// that screen (tap a pin on the Map) without leaving the tutorial; `tryIt`
// says so.
export const TABS = [
  { tab: 'Map', path: '/', live: true, tryIt: 'Try it: tap a pin.', icon: '\u{1F310}', say: 'The Map shows every landmark near you. Tap a pin to see the place and check in when you are there.' },
  { tab: 'Landmarks', path: '/landmarks', icon: '\u{1F4CD}', say: 'Landmarks lists every place by city, with the top landmarks first.' },
  { tab: 'Mapr', path: '/mapr', icon: '\u{1F9E0}', say: 'Ask me anything here: where to eat, what to see this afternoon, or how the app works.' },
  { tab: 'Itinerary', path: '/itinerary', icon: '\u{1F5FA}\u{FE0F}', say: 'Plan a trip, alone or with friends. I can fill a day with places you will like.' },
  { tab: 'Profile', path: '/profile', icon: '\u{1F3C6}', say: 'Your points, streaks, memories and friends live here, along with the leaderboard.' },
];
