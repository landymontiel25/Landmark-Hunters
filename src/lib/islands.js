import { KEYBISCAYNE_LANDMARKS } from '../data/landmarks.keybiscayne.js';

// Places on an island show a red map pin until you check in, then green like
// every other place (owner, 2026-11-18). Mainland places keep the blue pin.
// The Abacos are all cays; Key Biscayne and Virginia Key are Miami's islands
// (their landmarks fold into the Miami region). The Rickenbacker Causeway is
// the road out to them, not a place on them.
const ISLAND_REGIONS = new Set(['abacos']);
const MIAMI_ISLAND_IDS = new Set(KEYBISCAYNE_LANDMARKS.map((l) => l.id).filter((id) => id !== 'rickenbacker-causeway'));

export function isIslandPlace(l) {
  if (!l) return false;
  if (l.island === true) return true;
  const region = l.regionId || l.region;
  return ISLAND_REGIONS.has(region) || (region === 'miami' && MIAMI_ISLAND_IDS.has(l.id));
}
