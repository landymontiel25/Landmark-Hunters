import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { useMaprChat } from "../lib/MaprChatContext";
import { REGIONS } from "../data/regions";
import "./MaprUILab.css";

// Test tab: "UI". The owner's redesign of the Mapr home screen, built to
// match their mockup (dark screen, orb, "Hey <name>," greeting, ask bar,
// quick chips, "Try asking about..." photo cards, recent chats). It is live:
// the ask bar, chips and cards send a real question to Mapr, the city pill
// switches city, and the recent chats are your own. Nothing here changes the
// real Mapr tab until the owner approves the look.

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
      <path
        d="M9 4l6 2.5V20l-6-2.5z"
        fill="#4f7dff"
        stroke="none"
        opacity="0.9"
      />
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
  heart: (
    <Icon d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z" />
  ),
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

const CHIPS = [
  {
    id: "dinner",
    label: "Dinner tonight",
    icon: "dinner",
    ask: (c) => `Dinner tonight in ${c}`,
  },
  {
    id: "day",
    label: "A full day itinerary",
    icon: "map",
    ask: (c) => `Plan a full day itinerary in ${c}`,
  },
  {
    id: "outdoors",
    label: "Outdoors",
    icon: "outdoors",
    ask: (c) => `Something outdoors in ${c}`,
  },
  {
    id: "gems",
    label: "Hidden gems",
    icon: "gems",
    ask: (c) => `Hidden gems in ${c}`,
  },
  {
    id: "cheap",
    label: "Under $50",
    icon: "tag",
    ask: (c) => `Things to do in ${c} under $50`,
  },
  {
    id: "lowkey",
    label: "Keep it lowkey",
    icon: "heart",
    ask: (c) => `Something lowkey in ${c}`,
  },
];

// The "Try asking about..." cards. Each picks a photo from the chosen city's
// own landmarks (preferred ids first, then any landmark with a photo), so
// the cards always show real places in that city.
const PROMPTS = [
  {
    id: "dinner",
    title: ["Best dinner", "spots tonight"],
    ask: (c) => `Best dinner spots tonight in ${c}`,
    prefer: ["bayfront-park", "bayside-marketplace"],
  },
  {
    id: "day",
    title: (c) => ["A full day", `in ${c}`],
    ask: (c) => `Plan a full day in ${c}`,
    prefer: ["south-pointe-park", "south-beach"],
  },
  {
    id: "gems",
    title: ["Hidden gems", "near me"],
    ask: (c) => `Hidden gems near me in ${c}`,
    prefer: ["wynwood-walls"],
  },
  {
    id: "rooftop",
    title: ["Rooftop drinks", "with a view"],
    ask: (c) => `Rooftop drinks with a view in ${c}`,
    prefer: ["lincoln-road", "espanola-way"],
  },
  {
    id: "culture",
    title: ["Museums", "worth the trip"],
    ask: (c) => `Museums worth the trip in ${c}`,
    prefer: ["perez-art-museum-miami", "vizcaya-museum-and-gardens"],
  },
];

// Shown when you have no chats yet, so the section looks like the mockup.
const SAMPLE_CHATS = [
  { id: "sample-1", title: "Plan a weekend in Miami", sample: true },
  { id: "sample-2", title: "Great coffee shops near Wynwood", sample: true },
  {
    id: "sample-3",
    title: "A 3-day itinerary (food, beach, culture)",
    sample: true,
  },
];

function chatIcon(title = "") {
  const t = title.toLowerCase();
  if (/itinerar|day|plan a (trip|route)|route/.test(t) && !/weekend/.test(t))
    return ICONS.map;
  if (/coffee|food|eat|dinner|lunch|brunch|restaurant|bar|drink/.test(t))
    return ICONS.dinner;
  if (/park|hike|outdoor|nature|trail/.test(t)) return ICONS.outdoors;
  return ICONS.palm;
}

function photoFor(region, prefer, used) {
  const withPhoto = region.landmarks.filter(
    (l) =>
      l.images?.[0] && !/Earth-moon|Solar%20system|He1523a/.test(l.images[0]),
  );
  const pick =
    prefer
      .map((id) => withPhoto.find((l) => l.id === id))
      .find((l) => l && !used.has(l.id)) ||
    withPhoto.find((l) => !used.has(l.id));
  if (!pick) return null;
  used.add(pick.id);
  return pick.images[0];
}

function initialsOf(user) {
  const name = (user?.displayName || "").trim();
  if (name) {
    const parts = name.split(/\s+/);
    return (
      (parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
    ).toUpperCase();
  }
  return (user?.email?.[0] || "M").toUpperCase();
}

export default function MaprUILab() {
  const { user } = useAuth();
  const { chats = [], openChat } = useMaprChat();
  const navigate = useNavigate();
  const [regionId, setRegionId] = useState("miami");
  const [cityOpen, setCityOpen] = useState(false);
  const [text, setText] = useState("");
  const [chip, setChip] = useState(null);
  const [allPrompts, setAllPrompts] = useState(false);
  const inputRef = useRef(null);
  const cityRef = useRef(null);
  const outerRef = useRef(null);
  // The screen is laid out at the mockup's own width (393pt, an iPhone) and
  // zoomed to fit, so every size and gap keeps the mockup's proportions on
  // any phone.
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const fit = () => setZoom(Math.min(el.clientWidth, 480) / 393 || 1);
    fit();
    const ro =
      typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const region = REGIONS.find((r) => r.id === regionId) || REGIONS[0];
  const city = region.name;
  const firstName = (user?.displayName || "").trim().split(/\s+/)[0] || "there";

  const cards = useMemo(() => {
    const used = new Set();
    return PROMPTS.map((p) => ({
      ...p,
      label: typeof p.title === "function" ? p.title(city) : p.title,
      photo: photoFor(region, p.prefer, used),
    }));
  }, [region, city]);

  const recent = chats.length ? chats.slice(0, 3) : SAMPLE_CHATS;

  useEffect(() => {
    if (!cityOpen) return undefined;
    const close = (e) => {
      if (cityRef.current && !cityRef.current.contains(e.target))
        setCityOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [cityOpen]);

  const ask = (question) => {
    const q = question.trim();
    if (!q) {
      inputRef.current?.focus();
      return;
    }
    navigate("/mapr", { state: { ask: q } });
  };

  const pickChip = (c) => {
    if (chip === c.id) {
      setChip(null);
      setText("");
      return;
    }
    setChip(c.id);
    setText(c.ask(city));
    inputRef.current?.focus();
  };

  const openRecent = (c) => {
    // A sample row (you have no chats yet) asks Mapr that question instead.
    if (c.sample) {
      ask(c.title);
      return;
    }
    openChat?.(c.id);
    navigate("/mapr");
  };

  return (
    <div className="mui" ref={outerRef}>
      <div className="mui-screen" style={{ zoom }}>
        <header className="mui-top">
          <h1 className="mui-brand">Mapr</h1>
          <div className="mui-top-right">
            <div className="mui-city-wrap" ref={cityRef}>
              <button
                type="button"
                className="mui-city"
                aria-haspopup="listbox"
                aria-expanded={cityOpen}
                onClick={() => setCityOpen((o) => !o)}
              >
                <svg
                  width="16"
                  height="18"
                  viewBox="0 0 16 18"
                  aria-hidden="true"
                >
                  <path
                    d="M8 0.8C4.2 0.8 1.3 3.7 1.3 7.4c0 4.6 5.4 9.3 6.1 9.9.3.2.9.2 1.2 0 .7-.6 6.1-5.3 6.1-9.9C14.7 3.7 11.8.8 8 .8z"
                    fill="#5b8cff"
                  />
                  <circle cx="8" cy="7.2" r="2.4" fill="#0d1018" />
                </svg>
                <span>{city}</span>
                <Icon size={14} stroke={1.8} d="m6 9 6 6 6-6" />
              </button>
              {cityOpen && (
                <ul className="mui-city-menu" role="listbox" aria-label="City">
                  {REGIONS.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={r.id === regionId}
                        className={r.id === regionId ? "on" : ""}
                        onClick={() => {
                          setRegionId(r.id);
                          setCityOpen(false);
                          if (chip)
                            setText(
                              CHIPS.find((c) => c.id === chip).ask(r.name),
                            );
                        }}
                      >
                        {r.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              className="mui-avatar"
              aria-label="Profile"
              onClick={() => navigate("/profile")}
            >
              {initialsOf(user)}
            </button>
          </div>
        </header>

        <div className="mui-orb-wrap" aria-hidden="true">
          <div className="mui-orb-glow" />
          <div className="mui-orb" />
        </div>

        <h2 className="mui-hello">Hey {firstName},</h2>
        <p className="mui-sub">What are you in the mood for?</p>

        <form
          className="mui-ask"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <svg
            className="mui-ask-spark"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
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
            aria-label="Tell Mapr what you're looking for"
            enterKeyHint="send"
          />
          <button type="submit" className="mui-send" aria-label="Send">
            <Icon size={22} stroke={2} d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
          </button>
        </form>

        <div className="mui-chips">
          {[CHIPS.slice(0, 3), CHIPS.slice(3)].map((row, i) => (
            <div className="mui-chip-row" key={i}>
              {row.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`mui-chip ${chip === c.id ? "on" : ""}`}
                  aria-pressed={chip === c.id}
                  onClick={() => pickChip(c)}
                >
                  {ICONS[c.icon]}
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="mui-section-head">
          <h3>Try asking about...</h3>
          <button
            type="button"
            className="mui-see-all"
            onClick={() => setAllPrompts((v) => !v)}
          >
            {allPrompts ? "Show less" : "See all"}
            <Icon
              size={16}
              stroke={2}
              d={allPrompts ? "m6 15 6-6 6 6" : "m9 6 6 6-6 6"}
            />
          </button>
        </div>
        <div className={`mui-cards ${allPrompts ? "grid" : ""}`}>
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              className="mui-card"
              onClick={() => ask(c.ask(city))}
            >
              {c.photo && (
                <img
                  src={c.photo}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              )}
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

        <div className="mui-section-head mui-recent-head">
          <h3>Your recent chats</h3>
          <button
            type="button"
            className="mui-see-all"
            onClick={() => navigate("/mapr", { state: { openChats: true } })}
          >
            See all
            <Icon size={16} stroke={2} d="m9 6 6 6-6 6" />
          </button>
        </div>
        <ul className="mui-recent">
          {recent.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="mui-row"
                onClick={() => openRecent(c)}
              >
                <span className="mui-row-icon">{chatIcon(c.title)}</span>
                <span className="mui-row-title">{c.title}</span>
                <Icon size={18} stroke={1.8} d="m9 6 6 6-6 6" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
