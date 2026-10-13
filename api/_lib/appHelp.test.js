import { describe, it, expect } from 'vitest';
import { TIP_MAX_CHARS, TIP_MAX_LINKS, TIP_MIN_CHARS, TIP_RATE_LIMIT, TIP_REPORT_HIDE, TIP_CHECKIN_MAX_AGE_DAYS, TIP_TAGS } from '../../src/lib/tips.js';
import { APP_HELP } from './appHelp.js';
import { MIN_RATINGS_FOR_PICKS, DEFAULT_DISTANCE_MI } from '../../src/lib/nearbyPicks.js';
import { MAX_REVIEW_PHOTOS } from '../../src/lib/reviews.js';
import { MAX_GROUP_MEMBERS } from '../../src/lib/groupTrips.js';
import { TASTE_DISPLAY_CAP, TASTE_MIN_GUESSES, TASTE_PERFECT_WINDOW, TASTE_WINDOW } from '../../src/lib/maprConstants.js';
import { CHECKIN_RADIUS_METERS, MAX_CHECKIN_PHOTOS, POINTS_PER_CHECKIN } from '../../src/lib/leaderboard.js';
import { PRESENCE_LIMITS } from '../../src/lib/presence.js';

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
  it('quotes the verified-visit radius and accuracy for each kind of place', () => {
    const { landmark, indoor, area } = PRESENCE_LIMITS;
    expect(APP_HELP).toContain(`${landmark.radiusMeters} m for a statue, building or single landmark (GPS accuracy ${landmark.maxAccuracyMeters} m or better)`);
    expect(APP_HELP).toContain(`${indoor.radiusMeters} m for a museum, restaurant, bar or other indoor place (accuracy ${indoor.maxAccuracyMeters} m or better)`);
    expect(APP_HELP).toContain(`${area.radiusMeters} m for a park, campus, beach or neighborhood (accuracy ${area.maxAccuracyMeters} m or better)`);
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
  it('describes tips with the same numbers the server enforces', () => {
    expect(APP_HELP).toContain(`${TIP_MIN_CHARS} to ${TIP_MAX_CHARS} characters`);
    expect(APP_HELP).toContain(`${TIP_RATE_LIMIT.limit} tips an hour, at most ${TIP_MAX_LINKS} links`);
    expect(APP_HELP).toContain(`${TIP_REPORT_HIDE} reports from different people hide the tip`);
    expect(APP_HELP).toContain(`under ${TIP_CHECKIN_MAX_AGE_DAYS} days old`);
    for (const t of TIP_TAGS) expect(APP_HELP).toContain(t.label);
  });
});
