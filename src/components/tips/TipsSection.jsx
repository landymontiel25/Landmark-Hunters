import { useCallback, useEffect, useRef, useState } from 'react';
import { blockUser } from '../../lib/blocks';
import { findTipCheckin } from '../../lib/tipCheckin';
import { tipTagLabel } from '../../lib/tips';
import { deleteMyTip, fetchTips, reactToTip, reportTip } from '../../lib/tipsApi';
import { logTipImpressions } from '../../lib/tipImpressions';
import TipComposer from './TipComposer';

// "From people who went" (docs/discovery-network-plan.md, Phase 1): tips
// from verified visits, under the landmark page's sourced facts. Tips come
// from api/tips.js, which hides blocked people both ways. Each tip can be
// marked helpful or saved (counts only: nobody sees who), reported (two
// reports hide it until the owner reviews it) or its author blocked: the
// App Store's filter, report and block (guideline 1.2).

const REPORT_REASONS = [
  { id: 'offensive', label: 'Offensive or hateful' },
  { id: 'spam', label: 'Spam or advertising' },
  { id: 'false', label: 'False or misleading' },
  { id: 'private-info', label: "Shares someone's private info" },
  { id: 'other', label: 'Something else' },
];

const monthLabel = (ym) => {
  if (typeof ym !== 'string' || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

function ownStatusNote(t) {
  if (t.status === 'removed') return 'A moderator removed this tip. Only you can see it.';
  if (t.status === 'withdrawn') return 'You deleted this tip after reports. It waits for review; only you can see it.';
  if (t.status === 'held') return "This tip is waiting for review before others can see it.";
  if (t.hidden) return 'People reported this tip, so it is hidden until it is reviewed.';
  return null;
}

export default function TipsSection({ landmark, user, toast }) {
  const region = landmark?.regionId || landmark?.region;
  const landmarkId = landmark?.id;
  const [tips, setTips] = useState(null);
  const [reactions, setReactions] = useState({});
  const [error, setError] = useState(null);
  const [tipCheckin, setTipCheckin] = useState(null);
  const [composing, setComposing] = useState(false);
  const [reporting, setReporting] = useState(null);
  const [busy, setBusy] = useState(null);
  const logged = useRef(new Set());

  const load = useCallback(async () => {
    if (!user || !region || !landmarkId) return;
    try {
      const out = await fetchTips(region, landmarkId);
      setTips(out.tips || []);
      setReactions(out.reactions || {});
      setError(null);
    } catch (e) {
      setError(e?.userMessage || "Couldn't load tips.");
      setTips((t) => t || []);
    }
  }, [user, region, landmarkId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user || !landmarkId) return;
    let cancelled = false;
    findTipCheckin(user.uid, landmarkId).then((c) => {
      if (!cancelled) setTipCheckin(c);
    });
    return () => {
      cancelled = true;
    };
  }, [user, landmarkId]);

  // One impression row per tip shown (surface 'landmark-page'), so tips can
  // be measured later; never counted as a Mapr pick.
  useEffect(() => {
    if (!user || !tips?.length) return;
    const fresh = tips.filter((t) => !t.mine && !logged.current.has(t.id));
    if (!fresh.length) return;
    fresh.forEach((t) => logged.current.add(t.id));
    logTipImpressions({ uid: user.uid, landmarkId, region, tipIds: fresh.map((t) => t.id) });
  }, [tips, user, landmarkId, region]);

  if (!user) return null;
  const mine = tips?.find((t) => t.mine) || null;
  const others = (tips || []).filter((t) => !t.mine);
  const canShare = !!tipCheckin && !mine;

  const react = async (t, kind) => {
    const on = !reactions[t.id]?.[kind];
    setBusy(`${t.id}:${kind}`);
    try {
      const out = await reactToTip(t.id, kind, on);
      setReactions((r) => ({ ...r, [t.id]: out.reaction }));
      setTips((list) => list.map((x) => (x.id === t.id ? { ...x, counts: { ...x.counts, [kind]: Math.max(0, (x.counts?.[kind] || 0) + (on ? 1 : -1)) } } : x)));
    } catch (e) {
      toast?.show?.(e?.userMessage || "Couldn't save that. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const report = async (t, reason) => {
    setBusy(`${t.id}:report`);
    try {
      await reportTip(t.id, reason);
      setReporting(null);
      setTips((list) => list.filter((x) => x.id !== t.id));
      toast?.show?.('Thanks. The tip is hidden for you, and we will review it.');
    } catch (e) {
      toast?.show?.(e?.userMessage || "Couldn't send that report. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const block = async (t) => {
    if (!window.confirm(`Block ${t.authorName}? You won't see each other's tips or reviews.`)) return;
    setBusy(`${t.id}:block`);
    try {
      await blockUser(user.uid, t.authorUid, t.authorName);
      setTips((list) => list.filter((x) => x.authorUid !== t.authorUid));
      toast?.show?.(`${t.authorName} is blocked.`);
    } catch {
      toast?.show?.(`Couldn't block ${t.authorName}. Try again.`);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!mine || !window.confirm('Delete your tip?')) return;
    setBusy('mine:delete');
    try {
      await deleteMyTip(landmarkId, region);
      await load();
    } catch (e) {
      toast?.show?.(e?.userMessage || "Couldn't delete the tip. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const renderTip = (t) => {
    const r = reactions[t.id] || {};
    const note = t.mine ? ownStatusNote(t) : null;
    const month = monthLabel(t.visitMonth);
    return (
      <li key={t.id} className="tip-item card" style={{ padding: 12, marginBottom: 10, listStyle: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
          <strong>{t.mine ? 'Your tip' : t.authorName}</strong>
          <span className="presence-line presence-verified" style={{ fontSize: '0.75rem' }}>
            {'✓'} Verified visit{month ? ` · ${month}` : ''}
          </span>
        </div>
        <p style={{ margin: '6px 0', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t.text}</p>
        {t.tags?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {t.tags.map((tag) => (
              <span key={tag} className="chip" style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                {tipTagLabel(tag)}
              </span>
            ))}
          </div>
        )}
        {t.photoURL && <img src={t.photoURL} alt={`Photo with ${t.mine ? 'your' : `${t.authorName}'s`} tip`} loading="lazy" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 10, marginBottom: 6 }} />}
        {note && (
          <p className="screen-subtitle" style={{ margin: '4px 0', fontSize: '0.8rem' }}>
            {note}
          </p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {t.mine ? (
            <>
              <span className="screen-subtitle" style={{ fontSize: '0.8rem' }}>
                {t.counts.helpful} found it helpful · {t.counts.saved} saved
              </span>
              {t.status !== 'removed' && t.status !== 'withdrawn' && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={remove} disabled={busy === 'mine:delete'}>
                  Delete
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className={`btn btn-sm ${r.helpful ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={!!r.helpful} disabled={!!busy} onClick={() => react(t, 'helpful')}>
                {'\u{1F44D}'} Helpful {t.counts.helpful > 0 ? t.counts.helpful : ''}
              </button>
              <button type="button" className={`btn btn-sm ${r.saved ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={!!r.saved} disabled={!!busy} onClick={() => react(t, 'saved')}>
                {'\u{1F516}'} {r.saved ? 'Saved' : 'Save'} {t.counts.saved > 0 ? t.counts.saved : ''}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setReporting(reporting === t.id ? null : t.id)} aria-expanded={reporting === t.id}>
                Report
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => block(t)}>
                Block
              </button>
            </>
          )}
        </div>
        {reporting === t.id && (
          <div role="group" aria-label="Why are you reporting this tip?" style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {REPORT_REASONS.map((rr) => (
              <button key={rr.id} type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => report(t, rr.id)}>
                {rr.label}
              </button>
            ))}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="section tips-section">
      <h3>From people who went</h3>
      <p className="screen-subtitle" style={{ marginTop: -6, fontSize: '0.8rem' }}>
        Tips from verified visits. They are people's own words, not checked facts.
      </p>
      {canShare &&
        (composing ? (
          <TipComposer
            uid={user.uid}
            checkinId={tipCheckin.id}
            landmarkName={landmark?.name}
            onCancel={() => setComposing(false)}
            onPosted={(out) => {
              setComposing(false);
              toast?.show?.(out?.status === 'held' ? 'Thanks! Your tip shows once it is reviewed.' : 'Thanks! Your tip is up.');
              load();
            }}
          />
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setComposing(true)} style={{ marginBottom: 10 }}>
            {'\u{1F4A1}'} Share a tip for others
          </button>
        ))}
      {tips == null ? (
        <p className="screen-subtitle">Loading tips…</p>
      ) : (
        <>
          {error && <p className="screen-subtitle">{error}</p>}
          <ul style={{ padding: 0, margin: 0 }}>
            {mine && renderTip(mine)}
            {others.map(renderTip)}
          </ul>
          {!error && !mine && others.length === 0 && (
            <p className="screen-subtitle" style={{ margin: 0 }}>
              No tips yet.{tipCheckin ? '' : ' Check in here with location on to share the first one.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
