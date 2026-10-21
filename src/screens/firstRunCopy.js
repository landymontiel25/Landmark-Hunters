// Every word Tutorial 2 shows (Test tab, screens/FirstRunLab.jsx), from the
// owner's First-Run Tutorial Build Guide. Edit here. The guide's rules: plain
// words, no em dashes, hints under 12 words (firstRunCopy.test.js checks).
export const COPY = {
  welcome: { title: 'Find one new place today.', button: 'Show me', skip: 'Skip' },
  taste: {
    title: 'What are you into?',
    sub: 'Pick 3 to 5.',
    usePrefs: 'Use my preferences',
    button: 'Next',
  },
  swipe: {
    title: 'Would you go?',
    hint: 'Swipe right if it looks good.',
    yes: 'Interested',
    unsure: 'Not sure',
    no: 'Not for me',
  },
  rate: {
    title: 'Been here?',
    sub: 'Rate for yourself. This teaches us your taste.',
    labels: { 'highly-recommend': 'I loved it', 'worth-trying': 'It was okay', 'probably-skip': 'Not for me' },
    notBeen: "Haven't been here",
  },
  checkin: {
    title: 'Your first check-in',
    away: (dist, need) => `You are ${dist} away. Get within ${need} to check in.`,
    here: "You're here. Check in for your first points.",
    noLocation: 'We use your location to see if you are at the place.',
    button: 'Check in',
  },
  progress: {
    title: (goal) => `Rate ${goal} places and your picks get sharper.`,
    of: (n, goal) => `${n} of ${goal} ratings`,
    badge: 'First check-in!',
    button: 'Next',
  },
  done: { title: "You're set.", sub: 'Go find your first landmark.' },
  skipped: { title: 'Tutorial skipped.', sub: 'The app opens the Map now.' },
  signup: {
    title: {
      save_streak: 'Sign up to save your streak.',
      add_friend: 'Sign up to add friends.',
      keep_ratings: 'Sign up to keep your ratings.',
    },
    email: 'Continue with email',
    google: 'Continue with Google',
    apple: 'Continue with Apple',
    notNow: 'Not now',
  },
  skipStep: 'Skip',
  skipAll: 'Skip all',
};
