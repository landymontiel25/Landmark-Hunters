// The Test tab's "Tutorial" bubble (SignupTutorialLab): Mapr walks a new
// user through signing up and their first minutes in the app. Edit the
// words here; each step's `mock` picks the little screen drawn above Mapr's
// bubble (see MOCKS in SignupTutorialLab.jsx). `say` is a list: one Mapr
// bubble per line. Order matches the real new-account path in
// screens/Onboarding.jsx (verify -> rate 10 -> first check-in -> Always
// location on iOS -> done), followed by a tour of the five tabs.
export const TUTORIAL_STEPS = [
  {
    id: 'hello',
    title: 'Welcome',
    mock: 'hello',
    say: [
      "Hi! I'm Mapr, your personal AI guide to Landmark Hunters.",
      "I'll show you how to sign up and what happens next. It takes about a minute.",
    ],
  },
  {
    id: 'account',
    title: 'Create your account',
    mock: 'signup',
    say: [
      'Pick a display name, add your email and a password (6 characters or more).',
      'Tick the box to confirm you are 13 or older, then tap Create Account. Or skip the form and tap Sign up with Google.',
    ],
  },
  {
    id: 'verify',
    title: 'Verify your email',
    mock: 'verify',
    say: [
      'I send you an email with a link. Tap it, then come back to the app.',
      'This screen waits until you verify. It is the one step you cannot skip.',
    ],
  },
  {
    id: 'rate',
    title: 'Rate 10 places',
    mock: 'rate',
    say: [
      "Next I show you places one at a time. Tap I loved it, Ok, or I didn't like it.",
      "Haven't been? Tap Haven't been / not sure and I skip it. After 10 ratings I can start picking places for you.",
    ],
  },
  {
    id: 'checkin',
    title: 'Your first check-in',
    mock: 'checkin',
    say: [
      'If you are standing at a landmark right now, check in for your first points.',
      'Not near one? Tap Skip for now. You can check in from the Map any time.',
    ],
  },
  {
    id: 'location',
    title: 'Always know where you are',
    mock: 'location',
    say: [
      'In the iPhone app I ask to switch location from While Using to Always.',
      'That lets me tell you when you pass a place worth a stop. You can skip this too.',
    ],
  },
  {
    id: 'map',
    title: 'Map',
    mock: 'tabs',
    tab: 'Map',
    say: ['The Map shows every landmark near you. Tap a pin to see the place and check in when you are there.'],
  },
  {
    id: 'places',
    title: 'Places',
    mock: 'tabs',
    tab: 'Places',
    say: ['Places lists landmarks by city, ordered by what I think you will like most.'],
  },
  {
    id: 'mapr',
    title: 'Mapr',
    mock: 'tabs',
    tab: 'Mapr',
    say: ['Ask me anything here: where to eat, what to see this afternoon, or how the app works.'],
  },
  {
    id: 'itinerary',
    title: 'Itinerary',
    mock: 'tabs',
    tab: 'Itinerary',
    say: ['Plan a trip, alone or with friends. I can fill a day with places you will like.'],
  },
  {
    id: 'profile',
    title: 'Profile',
    mock: 'tabs',
    tab: 'Profile',
    say: ['Your points, streaks, memories and friends live here, along with the leaderboard.'],
  },
  {
    id: 'swipe',
    title: 'Teach me more',
    mock: 'swipe',
    say: [
      'Want better picks? Later, tap the banner on the Map or Mapr tab to swipe through 39 cards.',
      'Swipe right if you love it, left if not, or tap the card if you are not sure.',
    ],
  },
  {
    id: 'done',
    title: "You're set",
    mock: 'done',
    say: ["That's it! Go find your first landmark. I'll be here when you need me."],
  },
];
