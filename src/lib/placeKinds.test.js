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

describe('kinds checked on Miami and San Francisco data', () => {
  it('Market Street is not a food market; Café in a name is not a coffee shop', () => {
    const zuni = food('Zuni Cafe', { summary: 'A Market Street restaurant known for its roast chicken.' });
    expect(placeKinds(zuni).has('food-hall')).toBe(false);
    expect(placeKinds(zuni).has('coffee')).toBe(false);
    const mangos = { name: "Mango's Tropical Cafe", categories: ['local-life'], summary: 'Nightclub on Ocean Drive with live music and dancing.' };
    expect(placeKinds(mangos).has('coffee')).toBe(false);
    expect(placeKinds(mangos).has('nightclub')).toBe(true);
    const cafe = food('Panther Coffee', { topic: 'café', summary: 'Café on Northwest 2nd Avenue.' });
    expect(placeKinds(cafe).has('coffee')).toBe(true);
  });

  it('a music hall is not American food; a restaurant is matched on its food, not its bar', () => {
    const hall = { name: 'Great American Music Hall', categories: ['entertainment'], summary: 'A historic live music venue.' };
    expect(placeKinds(hall).has('american')).toBe(false);
    expect(placeKinds(hall).has('live-music')).toBe(true);
    const italian = food('Divieto Ristorante', { summary: 'Italian restaurant with a cocktail lounge.' });
    const cigarBar = { ...food('Cigar Lounge', { summary: 'Cocktail bar and lounge.' }), categories: ['food'] };
    const trattoria = food('Trattoria Uno', { summary: 'Italian trattoria.' });
    expect(kindSimilarity(italian, cigarBar)).toBe(0);
    expect(kindSimilarity(italian, trattoria)).toBeGreaterThan(0);
  });

  it('shops have kinds, and one chain fills one slot', () => {
    const shop = (name, summary) => ({ id: name, regionId: 'miami', name, categories: ['local-life'], summary, facts: [] });
    expect(placeKinds(shop('Books & Books', 'Independent bookstore.')).has('bookstore')).toBe(true);
    expect(placeKinds(shop('CocoWalk', 'Open-air shopping mall.')).has('shopping')).toBe(true);
    const at = (l, mi) => ({ ...l, distanceMeters: mi * 1609 });
    const chain = [1, 2, 3].map((i) => at({ ...food('Shake Stand', { summary: 'Burger restaurant.' }), id: `s${i}` }, i));
    const names = similarPlaces({ liked: burgers, pool: [...chain, at(burgers2, 5)] }).map((p) => p.name);
    expect(names.filter((n) => n === 'Shake Stand')).toHaveLength(1);
  });

  it('knows Spanish, French, Caribbean and poke', () => {
    expect(placeKinds(food('Casa Tapas', { summary: 'Spanish tapas bar.' })).has('spanish')).toBe(true);
    expect(placeKinds(food('Le Bistro', { summary: 'French brasserie.' })).has('french')).toBe(true);
    expect(placeKinds(food('Island Pot', { summary: 'Jamaican restaurant.' })).has('caribbean')).toBe(true);
    expect(placeKinds(food('Poke Bar', { summary: 'Hawaiian poke bowls.' })).has('poke')).toBe(true);
  });
});

