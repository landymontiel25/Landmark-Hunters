import { describe, it, expect } from 'vitest';
import { trimTurns, conciseReply, asksToRateHere, asksToRate, linkAddresses, remapAddressTokens, unparsedReply } from './plan-ai.js';

describe('plan-ai trimTurns', () => {
  it('never starts with an assistant turn once a chat is long (the API rejects that)', () => {
    const chat = Array.from({ length: 13 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }));
    const turns = trimTurns(chat);
    expect(turns[0].role).toBe('user');
    expect(turns[turns.length - 1].role).toBe('user');
    expect(turns.length).toBeLessThanOrEqual(10);
  });

  it('keeps short chats intact and drops junk entries', () => {
    expect(trimTurns([{ role: 'user', content: ' hi ' }, null, { role: 'system', content: 'x' }, { role: 'user', content: '  ' }])).toEqual([
      { role: 'user', content: 'hi' },
    ]);
    expect(trimTurns(undefined)).toEqual([]);
  });
});

describe('plan-ai conciseReply', () => {
  const long =
    "Your taste score improves when Mapr guesses right. **Rate places I suggest** to give me data. Answer pick cards honestly. Be specific in comments. The more you rate the better.";

  it('cuts a long answer to two plain sentences', () => {
    expect(conciseReply(long, 'how can i bring up my taste score')).toBe(
      'Your taste score improves when Mapr guesses right. Rate places I suggest to give me data.'
    );
  });

  it('keeps the full answer when they ask for more', () => {
    expect(conciseReply(long, 'explain how my taste score works')).toContain('The more you rate the better.');
    expect(conciseReply(long, 'tell me more')).not.toContain('**');
  });

  it('strips list markers and leaves short replies alone', () => {
    expect(conciseReply('- One thing', 'hi')).toBe('One thing');
    expect(conciseReply('Try Hillstone.', 'dinner?')).toBe('Try Hillstone.');
    expect(conciseReply('', 'x')).toBe('');
  });
});

describe('plan-ai asksToRateHere', () => {
  it('spots a request to rate where they are', () => {
    expect(asksToRateHere('can i rate here')).toBe(true);
    expect(asksToRateHere('Can I rate this place?')).toBe(true);
    expect(asksToRateHere('i want to rate where i am')).toBe(true);
  });
  it('ignores everything else', () => {
    expect(asksToRateHere('where should I eat here')).toBe(false);
    expect(asksToRateHere('rate Hillstone')).toBe(false);
    expect(asksToRateHere('')).toBe(false);
  });
});

describe('plan-ai asksToRate', () => {
  it('spots any ask to rate', () => {
    for (const t of ['can i rate here', 'No, can I rate here?', 'can I rate a landmark', 'let me rate some places', 'I want to rate', 'give me places to rate', 'rate more places'])
      expect(asksToRate(t)).toBe(true);
  });
  it('leaves other talk alone', () => {
    for (const t of ['how do i increase my taste score', 'what should I eat', 'rate Hillstone', 'accurate map'])
      expect(asksToRate(t)).toBe(false);
  });
});

describe('plan-ai linkAddresses', () => {
  it("turns a stop's address into a token for that stop", () => {
    const stops = [{ name: 'Dale', address: '1711 Coral Way, Miami, FL 33145' }];
    expect(linkAddresses("Sure, it's at 1711 Coral Way, Miami, FL 33145.", stops)).toBe("Sure, it's at {{address:1}}.");
    expect(linkAddresses('Dale is on 1711 Coral Way near the park.', stops)).toBe('Dale is on {{address:1}} near the park.');
  });
  it('turns any other street address into a search token, and leaves plain numbers alone', () => {
    expect(linkAddresses('Doggi is at 1246 Coral Way.')).toBe('Doggi is at {{addressq:1246%20Coral%20Way}}.');
    expect(linkAddresses('It is 5 km away, founded in 1999.')).toBe('It is 5 km away, founded in 1999.');
  });
});

describe('plan-ai remapAddressTokens', () => {
  it("points the model's {{address:N}} at the stop it meant after some stops were dropped", () => {
    // Model stops 1 and 3 were dropped; kept stops came from model positions 2 and 4.
    expect(remapAddressTokens('A {{address:2}} and B {{address:4}}.', [2, 4])).toBe('A {{address:1}} and B {{address:2}}.');
  });
  it('turns a token for a dropped or missing stop into plain "address"', () => {
    expect(remapAddressTokens("Here's the {{address:1}}.", [2])).toBe("Here's the address.");
    expect(remapAddressTokens("Here's the {{address:9}}.", [])).toBe("Here's the address.");
    expect(remapAddressTokens('No tokens, {{addressq:x}} kept.', [1])).toBe('No tokens, {{addressq:x}} kept.');
  });
});

describe('plan-ai unparsedReply', () => {
  it('keeps plain text, recovers a cut-off reply, and never shows the JSON blob', () => {
    expect(unparsedReply('Just plain words.')).toBe('Just plain words.');
    expect(unparsedReply('{"reply": "Try Autana.", "stops": [{"match": "mia')).toBe('Try Autana.');
    expect(unparsedReply('Let me search for that.\n{"reply": "Here are some spots, like')).toBe('Let me search for that.');
    expect(unparsedReply('Searching now.\n{"reply": "Try Autana.", "stops": [')).toBe('Try Autana.');
    expect(unparsedReply('{"reply": "cut off mid')).toBe('');
  });
  it('keeps a plain reply whole when it has address tokens or a stray brace', () => {
    expect(unparsedReply("Sure, here's the {{address:1}}. It's open until 10pm.")).toBe("Sure, here's the {{address:1}}. It's open until 10pm.");
    expect(unparsedReply("Try the {secret} menu at Joe's.")).toBe("Try the {secret} menu at Joe's.");
  });
});

describe('plan-ai text helpers: nightly fixes', () => {
  it('does not read "rate" as a noun as an ask to rate', () => {
    for (const t of ["What's the crime rate here?", 'whats the exchange rate here', 'Is the hotel rate here ok', 'Can you find a first-rate sushi spot?']) {
      expect(asksToRateHere(t)).toBe(false);
      expect(asksToRate(t)).toBe(false);
    }
    expect(asksToRate('wanna rate some stuff')).toBe(true);
    expect(asksToRateHere('Rate this spot')).toBe(true);
  });
  it('keeps city, state, ZIP and a street direction inside the address', () => {
    expect(linkAddresses('Go to 1237 E Passyunk Ave, Philadelphia, PA 19147.')).toBe(
      'Go to {{addressq:1237%20E%20Passyunk%20Ave%2C%20Philadelphia%2C%20PA%2019147}}.'
    );
    expect(linkAddresses('See 1600 Pennsylvania Ave NW, Washington, DC 20500 today')).toBe(
      'See {{addressq:1600%20Pennsylvania%20Ave%20NW%2C%20Washington%2C%20DC%2020500}} today'
    );
    expect(linkAddresses('Walk 10 Blocks Down Main St to it')).toBe('Walk 10 Blocks Down Main St to it');
  });
  it('does not cut a reply at a.m., p.m. or St.', () => {
    expect(conciseReply('Hours are 9 a.m. to 5 p.m. daily. Great spot. Third.', 'x')).toBe('Hours are 9 a.m. to 5 p.m. daily. Great spot.');
    expect(conciseReply('Open until 5 p.m. Great spot. Third.', 'x')).toBe('Open until 5 p.m. Great spot.');
  });
});

describe('plan-ai text helpers: review follow-ups', () => {
  it('still spots asks with a modal before rate', () => {
    for (const t of ['Can you show me places I can rate', 'anything I can rate nearby?', 'Ok rate here', "I'll rate this place"]) expect(asksToRate(t)).toBe(true);
    expect(asksToRateHere('Any places i can rate here?')).toBe(true);
  });
  it('never pulls the next sentence into an address', () => {
    expect(linkAddresses('Try 400 Broad St, Philadelphia. It is great.')).toBe('Try {{addressq:400%20Broad%20St}}, Philadelphia. It is great.');
  });
  it('ends a sentence at a street name', () => {
    expect(conciseReply('Located on Main St. Great tacos. Third.', 'x')).toBe('Located on Main St. Great tacos.');
    expect(conciseReply('Head to St. Louis next. Fun. Third.', 'x')).toBe('Head to St. Louis next. Fun.');
  });
});

describe('plan-ai text helpers: second review', () => {
  it('treats price "rates" as questions, not asks to rate', () => {
    for (const t of ['Is there a student rate here?', 'Can I get a lower rate here?', 'what rate do they charge here']) {
      expect(asksToRate(t)).toBe(false);
      expect(asksToRateHere(t)).toBe(false);
    }
    expect(asksToRate('stuff I could rate')).toBe(true);
  });
  it('links cities that start with St. or Ft.', () => {
    expect(linkAddresses('1 Las Olas Blvd, Ft. Lauderdale, FL is it')).toBe('{{addressq:1%20Las%20Olas%20Blvd%2C%20Ft.%20Lauderdale%2C%20FL}} is it');
  });
  it('keeps names with Mt. and St. in one sentence', () => {
    expect(conciseReply('Climb Mt. Rainier today. Fun. Third.', 'x')).toBe('Climb Mt. Rainier today. Fun.');
    expect(conciseReply('Go to 5 Main St. at noon. Great. Third.', 'x')).toBe('Go to 5 Main St. at noon. Great.');
  });
});

describe('plan-ai asksToRate: iPhone apostrophes', () => {
  it('reads curly apostrophes like straight ones', () => {
    for (const t of ['I’d rate here', 'I’ll rate this one', 'Let’s rate this spot', 'just rate this place']) expect(asksToRateHere(t)).toBe(true);
    expect(asksToRate('Let’s rate some places')).toBe(true);
  });
});
