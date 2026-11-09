import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { REGIONS } from '../data/regions';
import './MaprHome.css';

// Mapr's home (owner mockup, 2026-11-02): what the Mapr tab shows while no
// conversation is open. Orb, "Hey <name>,", the ask bar, quick chips, "Try
// asking about..." photo cards and your recent chats. Asking anything (the
// bar, a chip, a card) starts the chat on the same tab; the city pill sets
// the city Mapr plans in (Mapr.jsx's regions). Built iPhone first: laid out
// at the mockup's 393pt width and zoomed to the screen's width.

const Icon = ({ d, size = 20, stroke = 1.5, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {d ? <path d={d} /> : children}
  </svg>
);

const ICONS = {
  dinner: (
    <Icon>
      <path d="M5 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3" />
      <path d="M7 3v18" />
      <path d="M17 21V3c-2.2 1-3.5 3.4-3.5 6.5V13H17" />
      <path d="M17 13v8" />
    </Icon>
  ),
  map: (
    <Icon>
      <path d="M9 4l6 2.5V20l-6-2.5z" fill="#4f7dff" stroke="none" opacity="0.9" />
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
      <path d="M9 4v13.5" />
      <path d="M15 6.5V20" />
    </Icon>
  ),
  outdoors: (
    <Icon>
      <path d="M12 2.5 8 8h2.2L6.5 13h2.8L5 18.5h14L14.7 13h2.8L13.8 8H16z" />
      <path d="M12 18.5V22" />
    </Icon>
  ),
  gems: (
    <Icon>
      <path d="M10 4.5c.6 3.3 2.2 4.9 5.5 5.5-3.3.6-4.9 2.2-5.5 5.5-.6-3.3-2.2-4.9-5.5-5.5 3.3-.6 4.9-2.2 5.5-5.5z" />
      <path d="M18 3v3M16.5 4.5h3" />
      <path d="M18 16v4M16 18h4" />
    </Icon>
  ),
  tag: (
    <Icon>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.6 7.6a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0l-7.6-7.6a1 1 0 0 1-.3-.7z" />
      <circle cx="8" cy="8" r="1.3" />
    </Icon>
  ),
  heart: <Icon d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z" />,
  palm: (
    <Icon>
      <path d="M12 8.5c-.4 4.5.1 9 .9 13" />
      <path d="M12 8.5C10.3 5.4 6.6 4.6 4 6.2c2.6-.1 4.6.7 6 2.3" />
      <path d="M12 8.5c1.7-3.1 5.4-3.9 8-2.3-2.6-.1-4.6.7-6 2.3" />
      <path d="M12 8.5c-3-.4-5.9 1.3-6.7 4.3 1.6-1.6 3.4-2.3 5.3-2.2" />
      <path d="M12 8.5c3-.4 5.9 1.3 6.7 4.3-1.6-1.6-3.4-2.3-5.3-2.2" />
      <path d="M12 8.5c-.3-2.4.6-4.5 2.6-6" />
      <path d="M8.5 21.5h7" />
    </Icon>
  ),
};

// " in Miami", or nothing with no city chosen (Mapr then plans anywhere).
const at = (c) => (c ? ` in ${c}` : '');

const CHIPS = [
  {
    id: 'dinner',
    label: 'Dinner tonight',
    icon: 'dinner',
    ask: (c) => `Dinner tonight${at(c)}`,
  },
  {
    id: 'day',
    label: 'A full day itinerary',
    icon: 'map',
    ask: (c) => `Plan a full day itinerary${at(c)}`,
  },
  {
    id: 'outdoors',
    label: 'Outdoors',
    icon: 'outdoors',
    ask: (c) => `Something outdoors${at(c)}`,
  },
  {
    id: 'gems',
    label: 'Hidden gems',
    icon: 'gems',
    ask: (c) => `Hidden gems${at(c)}`,
  },
  {
    id: 'cheap',
    label: 'Under $50',
    icon: 'tag',
    ask: (c) => `Things to do${at(c)} under $50`,
  },
  {
    id: 'lowkey',
    label: 'Keep it lowkey',
    icon: 'heart',
    ask: (c) => `Something lowkey${at(c)}`,
  },
];

// The "Try asking about..." cards. Each picks a photo from the chosen city's
// own landmarks (preferred ids first, then any landmark with a photo), so
// the cards always show real places in that city.
const PROMPTS = [
  {
    id: 'dinner',
    title: ['Best dinner', 'spots tonight'],
    ask: (c) => `Best dinner spots tonight${at(c)}`,
    prefer: ['bayfront-park', 'bayside-marketplace'],
  },
  {
    id: 'day',
    title: (c) => ['A full day', c ? `in ${c}` : 'out'],
    ask: (c) => `Plan a full day${at(c)}`,
    prefer: ['south-pointe-park', 'south-beach'],
  },
  {
    id: 'gems',
    title: ['Hidden gems', 'near me'],
    ask: (c) => `Hidden gems near me${at(c)}`,
    prefer: ['wynwood-walls'],
  },
  {
    id: 'rooftop',
    title: ['Rooftop drinks', 'with a view'],
    ask: (c) => `Rooftop drinks with a view${at(c)}`,
    prefer: ['lincoln-road', 'espanola-way'],
  },
  {
    id: 'culture',
    title: ['Museums', 'worth the trip'],
    ask: (c) => `Museums worth the trip${at(c)}`,
    prefer: ['perez-art-museum-miami', 'vizcaya-museum-and-gardens'],
  },
];

function chatIcon(title = '') {
  const t = title.toLowerCase();
  if (/itinerar|day|plan a (trip|route)|route/.test(t) && !/weekend/.test(t)) return ICONS.map;
  if (/coffee|food|eat|dinner|lunch|brunch|restaurant|bar|drink/.test(t)) return ICONS.dinner;
  if (/park|hike|outdoor|nature|trail/.test(t)) return ICONS.outdoors;
  return ICONS.palm;
}

function photoFor(region, prefer, used) {
  const withPhoto = region.landmarks.filter((l) => l.images?.[0] && !/Earth-moon|Solar%20system|He1523a/.test(l.images[0]));
  const pick = prefer.map((id) => withPhoto.find((l) => l.id === id)).find((l) => l && !used.has(l.id)) || withPhoto.find((l) => !used.has(l.id));
  if (!pick) return null;
  used.add(pick.id);
  return pick.images[0];
}

function initialsOf(user) {
  const name = (user?.displayName || '').trim();
  if (name) {
    const parts = name.split(/\s+/);
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  return (user?.email?.[0] || 'M').toUpperCase();
}

// regions / onSetRegions: Mapr's chosen cities (the pill shows the first).
// draft / onDraft: the ask bar's text (Mapr keeps it per chat).
// onAsk(text): sends text to Mapr. chats / onOpenChat / onSeeAllChats: the
// recent chats (hidden with none); See all opens the chat list.
// score / scoreEstimated: the Mapr Score shown inside the orb (null: still
// learning); onOrbTap opens the full score.
export default function MaprHome({
  regions = [],
  onSetRegions,
  draft = '',
  onDraft,
  onAsk,
  busy = false,
  chats = [],
  onOpenChat,
  onSeeAllChats = null,
  score = null,
  scoreEstimated = false,
  onOrbTap = null,
  children = null,
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cityOpen, setCityOpen] = useState(false);
  const [chip, setChip] = useState(null);
  const [allPrompts, setAllPrompts] = useState(false);
  const inputRef = useRef(null);
  const cityRef = useRef(null);
  const outerRef = useRef(null);
  // Laid out at the mockup's own width (393pt, an iPhone) and zoomed to fit,
  // so every size and gap keeps the mockup's proportions on any phone.
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const fit = () => setZoom(Math.min(el.clientWidth, 480) / 393 || 1);
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const chosen = regions[0] || null;
  const city = chosen?.name || null;
  // Card photos come from the chosen city's landmarks (Miami's with none).
  const region = (chosen && REGIONS.find((r) => r.id === chosen.id)) || REGIONS[0];
  const firstName = (user?.displayName || '').trim().split(/\s+/)[0] || 'there';
  const text = draft;
  const setText = (t) => onDraft?.(t);

  const cards = useMemo(() => {
    const used = new Set();
    return PROMPTS.map((p) => ({
      ...p,
      label: typeof p.title === 'function' ? p.title(city) : p.title,
      photo: photoFor(region, p.prefer, used),
    }));
  }, [region, city]);

  const recent = chats.slice(0, 3);

  useEffect(() => {
    if (!cityOpen) return undefined;
    const close = (e) => {
      if (cityRef.current && !cityRef.current.contains(e.target)) setCityOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [cityOpen]);

  const ask = (question) => {
    const q = question.trim();
    if (!q || busy) {
      inputRef.current?.focus();
      return;
    }
    setChip(null);
    onAsk?.(q);
  };

  const pickChip = (c) => {
    if (chip === c.id) {
      setChip(null);
      setText('');
      return;
    }
    setChip(c.id);
    setText(c.ask(city));
    inputRef.current?.focus();
  };

  const pickCity = (r) => {
    onSetRegions?.(r ? [r] : []);
    setCityOpen(false);
    if (chip) setText(CHIPS.find((c) => c.id === chip).ask(r?.name || null));
  };

  return (
    <div className="mui" ref={outerRef}>
      <div className="mui-screen" style={{ zoom }}>
        <header className="mui-top">
          <h1 className="mui-brand">Landmark Hunters</h1>
          <div className="mui-top-right">
            <div className="mui-city-wrap" ref={cityRef}>
              <button type="button" className="mui-city" aria-haspopup="listbox" aria-expanded={cityOpen} onClick={() => setCityOpen((o) => !o)}>
                <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
                  <path d="M8 0.8C4.2 0.8 1.3 3.7 1.3 7.4c0 4.6 5.4 9.3 6.1 9.9.3.2.9.2 1.2 0 .7-.6 6.1-5.3 6.1-9.9C14.7 3.7 11.8.8 8 .8z" fill="#5b8cff" />
                  <circle cx="8" cy="7.2" r="2.4" fill="#0d1018" />
                </svg>
                <span>{city || 'Any city'}</span>
                <Icon size={14} stroke={1.8} d="m6 9 6 6 6-6" />
              </button>
              {cityOpen && (
                <ul className="mui-city-menu" role="listbox" aria-label="City">
                  <li>
                    <button type="button" role="option" aria-selected={!chosen} className={!chosen ? 'on' : ''} onClick={() => pickCity(null)}>
                      Any city
                    </button>
                  </li>
                  {REGIONS.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={chosen?.id === r.id}
                        className={chosen?.id === r.id ? 'on' : ''}
                        onClick={() => pickCity(r)}
                      >
                        {r.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" className="mui-avatar" aria-label="Profile" onClick={() => navigate('/profile')}>
              {initialsOf(user)}
            </button>
          </div>
        </header>

        <button
          type="button"
          className="mui-orb-wrap"
          onClick={() => onOrbTap?.()}
          aria-label={score != null ? `Mapr Score ${scoreEstimated ? 'about ' : ''}${score}%. See your score` : 'Mapr Score: still learning. See your score'}
        >
          <span className="mui-orb-glow" />
          <span className="mui-orb" />
          <span className="mui-orb-score" aria-hidden="true">
            <strong>{score != null ? `${scoreEstimated ? '~' : ''}${score}%` : '…'}</strong>
            <small>Mapr Score</small>
          </span>
        </button>

        <h2 className="mui-hello">Hey {firstName},</h2>
        <p className="mui-sub">What are you in the mood for?</p>

        <form
          className="mui-ask"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <svg className="mui-ask-spark" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2.5c.7 4.9 2.9 7.6 8.5 9.5-5.6 1.9-7.8 4.6-8.5 9.5-.7-4.9-2.9-7.6-8.5-9.5 5.6-1.9 7.8-4.6 8.5-9.5z"
              stroke="#5b8cff"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (chip) setChip(null);
            }}
            placeholder="Tell Mapr what you're looking for..."
            aria-label="Message Mapr"
            name="mapr-message"
            maxLength={500}
            autoComplete="off"
            enterKeyHint="send"
          />
          <button type="submit" className="mui-send" aria-label="Send" disabled={busy}>
            <Icon size={22} stroke={2} d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
          </button>
        </form>

        {recent.length > 0 && (
          <>
            <div className="mui-section-head mui-recent-head">
              <h3>Your recent chats</h3>
              {onSeeAllChats && (
                <button type="button" className="mui-see-all" onClick={onSeeAllChats}>
                  See all
                  <Icon size={16} stroke={2} d="m9 6 6 6-6 6" />
                </button>
              )}
            </div>
            <ul className="mui-recent">
              {recent.map((c) => (
                <li key={c.id}>
                  <button type="button" className="mui-row" onClick={() => onOpenChat?.(c.id)}>
                    <span className="mui-row-icon">{chatIcon(c.title)}</span>
                    <span className="mui-row-title">{c.title}</span>
                    <Icon size={18} stroke={1.8} d="m9 6 6 6-6 6" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mui-chips">
          {[CHIPS.slice(0, 3), CHIPS.slice(3)].map((row, i) => (
            <div className="mui-chip-row" key={i}>
              {row.map((c) => (
                <button key={c.id} type="button" className={`mui-chip ${chip === c.id ? 'on' : ''}`} aria-pressed={chip === c.id} onClick={() => pickChip(c)}>
                  {ICONS[c.icon]}
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="mui-section-head">
          <h3>Try asking about...</h3>
          <button type="button" className="mui-see-all" onClick={() => setAllPrompts((v) => !v)}>
            {allPrompts ? 'Show less' : 'See all'}
            <Icon size={16} stroke={2} d={allPrompts ? 'm6 15 6-6 6 6' : 'm9 6 6 6-6 6'} />
          </button>
        </div>
        <div className={`mui-cards ${allPrompts ? 'grid' : ''}`}>
          {cards.map((c) => (
            <button key={c.id} type="button" className="mui-card" onClick={() => ask(c.ask(city))}>
              {c.photo && <img src={c.photo} alt="" loading="lazy" referrerPolicy="no-referrer" />}
              <span className="mui-card-shade" />
              <span className="mui-card-title">
                {c.label[0]}
                <br />
                {c.label[1]}
              </span>
              <span className="mui-card-go">
                <Icon size={16} stroke={2} d="M5 12h14M13 6l6 6-6 6" />
              </span>
            </button>
          ))}
        </div>
      </div>
      {children && <div className="mui-more">{children}</div>}
    </div>
  );
}
