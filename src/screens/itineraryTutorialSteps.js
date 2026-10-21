// Every word the Itinerary tutorial says (Test tab, screens/ItineraryTutorialLab).
// Edit here. Each step: a title, Mapr's lines (one bubble each) and `mock`,
// the drawn screen above them (MOCKS in ItineraryTutorialLab.jsx). Kept to
// what the Itinerary tab really does (api/_lib/appHelp.js).
export const INTRO = {
  title: 'Want to learn how to make an itinerary?',
  sub: 'It takes about a minute.',
  show: 'Show me',
  skip: 'Skip',
  skipped: 'No problem. Your itineraries are all yours.',
  done: "You're ready. Tap Use Mapr to plan your first trip.",
};

export const STEPS = [
  {
    id: 'start',
    title: 'Start a trip',
    mock: 'start',
    say: [
      'Tap Use Mapr. Tell me where you start and what you are into, and I plan your stops.',
      'Prefer a form? Create New Trip does the same thing step by step.',
    ],
  },
  {
    id: 'add',
    title: 'Add places',
    mock: 'add',
    say: [
      'See a place you like? Tap its bookmark, then add it to that city\'s itinerary.',
      'You can also ask me in chat: "add it to my Miami trip."',
    ],
  },
  {
    id: 'order',
    title: 'Put your stops in order',
    mock: 'order',
    say: [
      'I sort your stops into a walkable route for you.',
      'Want your own order? Tap Edit List, then drag the handle or tap the minus to remove a stop.',
    ],
  },
  {
    id: 'go',
    title: 'Go',
    mock: 'go',
    say: [
      'Tap Start Trip. Every stop gets a numbered pin, and I guide you there turn by turn.',
      'Share sends the list and a Google Maps link to anyone, even without the app.',
    ],
  },
  {
    id: 'friends',
    title: 'Plan with friends',
    mock: 'friends',
    say: [
      'Tap Add a user to plan together. Everyone on the trip can add stops.',
      'On a group trip you can share your live location while you go.',
    ],
  },
  {
    id: 'past',
    title: "When you're done",
    mock: 'past',
    say: ['Check in at every stop and the trip moves to Past on its own. That is it. Go plan one!'],
  },
];
