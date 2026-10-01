import { describe, it, expect } from 'vitest';
import { APP_HELP } from './appHelp.js';
import { MIN_RATINGS_FOR_PICKS, DEFAULT_DISTANCE_MI } from '../../src/lib/nearbyPicks.js';
import { MAX_REVIEW_PHOTOS } from '../../src/lib/reviews.js';
import { MAX_GROUP_MEMBERS } from '../../src/lib/groupTrips.js';
import { TASTE_DISPLAY_CAP, TASTE_MIN_GUESSES, TASTE_PERFECT_WINDOW, TASTE_WINDOW } from '../../src/lib/maprConstants.js';
import { CHECKIN_RADIUS_METERS, MAX_CHECKIN_PHOTOS, POINTS_PER_CHECKIN } from '../../src/lib/leaderboard.js';

// Mapr answers "how does the app work" from APP_HELP only, so the numbers it
// quotes must stay tied to the constants the app actually uses.
describe('APP_HELP stays in sync with code constants', () => {
  it('quotes the picks rating threshold', () => {
    expect(APP_HELP).toContain(`It needs ${MIN_RATINGS_FOR_PICKS} ratings`);
    expect(APP_HELP).toContain(`Rate ${MIN_RATINGS_FOR_PICKS} places`);
  });
  it('quotes the default picks distance', () => {
    expect(APP_HELP).toContain(`${DEFAULT_DISTANCE_MI} by default`);
  });
  it('quotes the photo caps', () => {
    expect(APP_HELP).toContain(`up to ${MAX_REVIEW_PHOTOS} can be added when you rate or check in`);
    expect(APP_HELP).toContain(`up to ${MAX_CHECKIN_PHOTOS} per check-in`);
    expect(APP_HELP).toContain(`holds at most ${MAX_REVIEW_PHOTOS} photos`);
  });
  it('quotes the group trip member cap', () => {
    expect(APP_HELP).toContain(`holds up to ${MAX_GROUP_MEMBERS} people`);
  });
  it('quotes the check-in radius and first-visit points', () => {
    expect(APP_HELP).toContain(`radius is ${CHECKIN_RADIUS_METERS} m`);
    expect(APP_HELP).toContain(`${POINTS_PER_CHECKIN} points on the 1st visit`);
  });
  it('quotes the taste score window, minimum, cap and perfect run', () => {
    expect(APP_HELP).toContain(`last ${TASTE_WINDOW} such guesses`);
    expect(APP_HELP).toContain(`until ${TASTE_MIN_GUESSES} guesses have been answered`);
    expect(APP_HELP).toContain(`above ${TASTE_DISPLAY_CAP}% until your last ${TASTE_PERFECT_WINDOW} guesses`);
  });
  it('explains the Just me / A group question', () => {
    expect(APP_HELP).toContain('"Just me" or "A group"');
  });
});
