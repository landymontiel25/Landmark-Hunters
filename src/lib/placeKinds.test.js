import { describe, it, expect } from 'vitest';
import { placeKinds, mainKinds, kindSimilarity, kindAffinity, kindBoost } from './placeKinds';
import { similarPlaces } from './nearbyPicks';

const food = (name, extra = {}) => ({ id: name.toLowerCase().replace(/\W+/g, '-'), regionId: 'philly', name, categories: ['food'], summary: '', facts: [], ...extra });
const fogo = food('Fogo de Chão', { summary: 'The Center City location of Fogo de Chão, a Brazilian steakhouse chain.' });
const flemings = food("Fleming's", { topic: 'steak restaurant', summary: 'Steak restaurant on East Lancaster Avenue, Radnor.', facts: ['Serves steak'] });
const depauls = food("DePaul's Table", { topic: 'Italian restaurant', summary: 'Italian restaurant.', facts: ['Italian steakhouse that replaced The Bercy in Ardmore.'] });
const hopes = food("Hope's Cookies", { summary: 'Bakery.', facts: ['Bakes giant stuffed cookies.'] });
const pho = food('Saigon Noodle Kitchen', { topic: 'Vietnamese restaurant', summary: 'Vietnamese restaurant.', facts: ['Pho comes with brisket, flank or eye round steak.'] });
const pats = food("Pat's King of Steaks", { summary: 'Credited with inventing the Philly cheesesteak.', facts: ['Founded in the Italian Market area'] });
const genos = food("Geno's Steaks", { summary: 'Famous for its cheesesteaks.' });
const sushi = food('Sushi Lab', { topic: 'sushi restaurant', summary: 'Sushi restaurant.' });
const burgers = food('Burger Joint', { summary: 'Burger restaurant.' });
const burgers2 = food('Shake Stand', { summary: 'Smash burgers and shakes.' });

describe('placeKinds', () => {
  it('reads what a place is', () => {
    expect([...placeKinds(fogo)]).toEqual(['steakhouse']);
    expect(placeKinds(hopes).has('sweets')).toBe(true);
    expect(placeKinds(flemings).has('steakhouse')).toBe(true);
  });

  it('never calls a cheesesteak shop or a pho place a steakhouse', () => {
    expect(placeKinds(pats).has('steakhouse')).toBe(false);
    expect(placeKinds(pats).has('cheesesteak')).toBe(true);
    expect(placeKinds(pho).has('steakhouse')).toBe(false);
  });

  it('trusts the description over passing mentions in facts', () => {
    expect(mainKinds(pats)).toEqual(['cheesesteak']);
    expect(mainKinds(depauls)).toEqual(['italian']);
    expect(placeKinds(depauls).has('steakhouse')).toBe(true);
  });

  it('reads no kind from a street name', () => {
    const pub = { name: 'Irish Times', categories: ['local-life'], topic: 'pub', summary: 'Pub on Sacramento Street.' };
    expect([...placeKinds(pub)]).toEqual(['bar']);
    const bar = { name: "AJ's Bar", categories: ['local-life'], topic: 'bar', summary: 'Bar on Market Street.' };
    expect(placeKinds(bar).has('food-hall')).toBe(false);
    const ramen = food('Waraku', { topic: 'ramen restaurant', summary: 'Ramen restaurant on Market Street, San Francisco.' });
    expect(placeKinds(ramen).has('japanese')).toBe(true);
  });

  it('does not call a bar named "Cafe" a coffee shop, or a bookstore a restaurant', () => {
    const vesuvio = { name: 'Vesuvio Cafe', categories: ['local-life'], topic: 'bar', summary: 'Beat-era bar in North Beach.' };
    expect(placeKinds(vesuvio).has('coffee')).toBe(false);
    expect(placeKinds(vesuvio).has('bar')).toBe(true);
    const trieste = food('Caffe Trieste', { topic: 'café', summary: 'Café on Vallejo Street.' });
    expect(placeKinds(trieste).has('coffee')).toBe(true);
    const books = { name: 'Sino American Books & Arts', categories: ['local-life'], topic: 'bookstore', summary: 'Bookstore.' };
    expect(placeKinds(books).size).toBe(0);
    const club = { name: 'Latin American Club', categories: ['local-life'], topic: 'bar', summary: 'Bar.' };
    expect(placeKinds(club).has('american')).toBe(false);
  });

  it('keeps kinds inside their category group', () => {
    const museum = { name: 'History Museum', categories: ['history-culture'], summary: 'A museum of local history with a cafe.' };
    expect(placeKinds(museum).has('coffee')).toBe(false);
    expect(placeKinds(museum).has('history')).toBe(true);
  });
});

describe('Because you liked (similarPlaces)', () => {
  const at = (l, mi) => ({ ...l, distanceMeters: mi * 1609 });
  it('after a steakhouse, steakhouses: never cookies, pho or cheesesteaks', () => {
    const pool = [at(hopes, 0.5), at(pho, 1), at(genos, 1), at(depauls, 3), at(flemings, 4)];
    expect(similarPlaces({ liked: fogo, pool }).map((p) => p.name)).toEqual(["Fleming's", "DePaul's Table"]);
  });

  it('sushi after sushi, burgers after burgers, cheesesteaks after cheesesteaks', () => {
    const pool = [at(hopes, 0.2), at(sushi, 2), at(burgers2, 3), at(genos, 4), at(flemings, 1)];
    expect(similarPlaces({ liked: food('Sushi Spot', { summary: 'Omakase sushi bar.' }), pool }).map((p) => p.name)).toEqual(['Sushi Lab']);
    expect(similarPlaces({ liked: burgers, pool }).map((p) => p.name)).toEqual(['Shake Stand']);
    expect(similarPlaces({ liked: pats, pool }).map((p) => p.name)).toEqual(["Geno's Steaks"]);
  });

  it('shows nothing rather than a different kind of place', () => {
    expect(similarPlaces({ liked: fogo, pool: [at(hopes, 0.5), at(sushi, 1)] })).toEqual([]);
  });
});

describe('kind affinity in the picks', () => {
  it('a loved steakhouse lifts other steakhouses; a disliked kind sinks its places', () => {
    const reviews = { a: { ratingTier: 'highly-recommend', landmarkId: 'fogo' }, b: { ratingTier: 'probably-skip', landmarkId: 'hopes' } };
    const byId = { fogo, hopes };
    const affinity = kindAffinity(reviews, (r) => byId[r.landmarkId]);
    expect(kindBoost(flemings, affinity)).toBeGreaterThan(0);
    expect(kindBoost(food('Cookie Co', { summary: 'Cookie shop.' }), affinity)).toBeLessThan(0);
    expect(kindBoost(sushi, affinity)).toBe(0);
    expect(kindSimilarity(fogo, flemings)).toBe(2);
    expect(kindSimilarity(fogo, depauls)).toBe(1);
  });
});
