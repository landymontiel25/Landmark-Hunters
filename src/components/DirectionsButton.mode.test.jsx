// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
const { default: DirectionsButton } = await import('./DirectionsButton.jsx');

const pills = () => [...document.querySelectorAll('.directions-sheet .itin-mode-pill')].map((b) => b.textContent);
const link = (re) => [...document.querySelectorAll('.directions-sheet a')].find((a) => re.test(a.textContent))?.getAttribute('href');

async function open(props) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(<DirectionsButton {...props} />));
  await act(async () => el.querySelector('button').click());
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('Get directions asks how you are getting around (owner, 2026-11-23)', () => {
  it('a mainland place (Brickell) never offers Boat; the pick goes to the links and the map', async () => {
    localStorage.setItem('lh-last-fix', JSON.stringify({ lat: 25.77, lng: -80.19, t: Date.now() }));
    await open({ name: 'Brickell City Centre', lat: 25.7672, lng: -80.1931, place: { id: 'brickell-city-centre', region: 'miami' } });
    expect(pills()).toEqual(['Walk', 'Drive', 'Bus', 'Bike']);
    expect(link(/Google/)).toContain('travelmode=walking');
    const drive = [...document.querySelectorAll('.itin-mode-pill')].find((b) => b.textContent === 'Drive');
    await act(async () => drive.click());
    expect(link(/Google/)).toContain('travelmode=driving');
    expect(link(/Apple/)).toContain('dirflg=d');
    const map = [...document.querySelectorAll('.directions-sheet button')].find((b) => /Open in Map/.test(b.textContent));
    await act(async () => map.click());
    expect(navigate).toHaveBeenCalledWith('/', { state: { directionsTo: expect.objectContaining({ mode: 'car' }) } });
  });

  it('an island place (the Abacos) offers Boat; Boat has no Google or Apple links', async () => {
    localStorage.setItem('lh-last-fix', JSON.stringify({ lat: 26.5462522, lng: -77.046387, t: Date.now() }));
    await open({ name: 'Tahiti Beach', lat: 26.5009193, lng: -76.9865984, place: { id: 'tahiti-beach', region: 'abacos' } });
    expect(pills()).toContain('Boat');
    expect(pills()).not.toContain('Bus');
    const boat = [...document.querySelectorAll('.itin-mode-pill')].find((b) => b.textContent === 'Boat');
    await act(async () => boat.click());
    expect(link(/Google/)).toBeUndefined();
    expect(document.querySelector('.directions-mode-note').textContent).toContain('boat');
  });
});
