import { useCallback, useEffect, useRef, useState } from 'react';
import { blockUser } from '../../lib/blocks';
import { findTipCheckin } from '../../lib/tipCheckin';
import { tipTagLabel } from '../../lib/tips';
import { useConfirm } from '../ConfirmSheet';
import { logMyReport } from '../../lib/myReports';
import { deleteMyTip, fetchTips, markTipsSeen, reactToTip, reportTip, TIPS_CHANGED_EVENT } from '../../lib/tipsApi';
import TipComposer from './TipComposer';
import OnScreen from '../OnScreen';
import FollowButton from '../FollowButton';

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

export default function TipsSection({ landmark, user, toast, refreshKey = '', visited = true }) {
  const region = landmark?.regionId || landmark?.region;
  const landmarkId = landmark?.id;
  const [tips, setTips] = useState(null);
  const [reactions, setReactions] = useState({});
  // The tip whose author card is open (follow a discoverer, Phase 2).
  const [authorOpen, setAuthorOpen] = useState(null);
  const [error, setError] = useState(null);
  const [tipCheckin, setTipCheckin] = useState(null);
  const [composing, setComposing] = useState(false);
  const [editingMine, setEditingMine] = useState(false);
  const [reporting, setReporting] = useState(null);
  const { confirm, node: confirmNode } = useConfirm();
  const [busy, setBusy] = useState(null);

  // Only the newest request may land (loads can overlap and finish out of
  // order).
  const requestNo = useRef(0);
  const load = useCallback(async () => {
    if (!user || !region || !landmarkId) return;
    const n = ++requestNo.current;
    try {
      const out = await fetchTips(region, landmarkId);
      if (n !== requestNo.current) return;
      setTips(out.tips || []);
      setReactions(out.reactions || {});
      setError(null);
    } catch (e) {
      if (n !== requestNo.current) return;
      setError(e?.userMessage || "Couldn't load tips.");
      setTips((t) => t || []);
    }
  }, [user, region, landmarkId]);

  // Reload after a check-in (refreshKey) and after a tip posts anywhere.
  useEffect(() => {
    load();
  }, [load, refreshKey]);
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener(TIPS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TIPS_CHANGED_EVENT, onChange);
  }, [load]);

  useEffect(() => {
    // Only where you've checked in: no checkins query on every page.
    if (!user || !landmarkId || !visited) {
      setTipCheckin(null);
      return undefined;
    }
    let cancelled = false;
    findTipCheckin(user.uid, landmarkId, region).then((c) => {
      if (!cancelled) setTipCheckin(c);
    });
    return () => {
      cancelled = true;
    };
  }, [user, landmarkId, region, refreshKey, visited]);

  // Each tip counts as seen once it is on screen (the server records the
  // view and the impression; see api/tips.js markSeen). Sent in small
  // batches, each tip at most once per page.
  const seenIds = useRef(new Set());
  const pending = useRef(new Set());
  const flushTimer = useRef(null);
  const flush = () => {
    flushTimer.current = null;
    const ids = [...pending.current];
    pending.current.clear();
    // A failed send leaves the tips unseen, so they go again next time.
    if (ids.length) markTipsSeen(ids).catch(() => ids.forEach((id) => seenIds.current.delete(id)));
  };
  useEffect(() => () => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flush();
  }, []);
  const onTipSeen = (id) => {
    // Views count only for verified accounts (the server ignores the rest).
    if (user?.emailVerified !== true || seenIds.current.has(id)) return;
    seenIds.current.add(id);
    pending.current.add(id);
    if (!flushTimer.current) flushTimer.current = setTimeout(flush, 800);
  };

  if (!user) return null;
  const mine = tips?.find((t) => t.mine) || null;
  const others = (tips || []).filter((t) => !t.mine);
  // Only once the list has loaded cleanly: until then "no tip of mine" is
  // unknown.
  const canShare = tips != null && !error && !!tipCheckin && !mine && user.emailVerified === true;

  const react = async (t, kind) => {
    const on = !reactions[t.id]?.[kind];
    setBusy(`${t.id}:${kind}`);
    try {
      const out = await reactToTip(t.id, kind, on);
      setReactions((r) => ({ ...r, [t.id]: out.reaction }));
      // The server's own counts after the change; none means the tip is no
      // longer public, so it leaves the list.
      setTips((list) => (out.counts ? list.map((x) => (x.id === t.id ? { ...x, counts: out.counts } : x)) : list.filter((x) => x.id !== t.id)));
    } catch (e) {
      toast?.show?.(e?.userMessage || "Couldn't save that. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const report = async (t, reason) => {
    if (
      !(await confirm({
        title: 'Report this tip?',
        body: [
          `Only report tips that are spam, abusive or about the wrong place. Two reports from different people hide it for everyone.`,
          "They won't be told who reported it. You can see what you've reported in Settings, under Blocked & Reported.",
        ],
        confirmLabel: 'Report',
      }))
    )
      return;
    setBusy(`${t.id}:report`);
    try {
      await reportTip(t.id, reason);
      logMyReport(user.uid, { kind: 'tip', targetId: t.id, label: `Tip${t.authorName ? ` by @${t.authorName}` : ''} on ${landmark?.name || 'a place'}`, landmarkId, regionId: region });
      setReporting(null);
      setTips((list) => list.filter((x) => x.id !== t.id));
      toast?.show?.('Thanks. The tip is hidden for you, and it will be reviewed.');
    } catch (e) {
      toast?.show?.(e?.userMessage || "Couldn't send that report. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const block = async (t) => {
    if (
      !(await confirm({
        title: `Block @${String(t.authorName || '').replace(/^@/, '')}?`,
        body: [
          "You won't see each other's tips, ratings or comments, and any friend request or follow between you ends.",
          'You can unblock anytime in Settings, under Blocked & Reported.',
        ],
        confirmLabel: 'Block',
      }))
    )
      return;
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
      // Every open tips list (this one included) reloads.
      window.dispatchEvent(new CustomEvent(TIPS_CHANGED_EVENT));
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
    if (t.mine && editingMine) {
      return (
        <li key={t.id} style={{ listStyle: 'none', marginBottom: 10 }}>
          <TipComposer
            uid={user.uid}
            landmarkName={landmark?.name}
            editing={{ landmarkId, region, text: t.text, tags: t.tags || [] }}
            onCancel={() => setEditingMine(false)}
            onPosted={(out) => {
              setEditingMine(false);
              // (The list reloads on TIPS_CHANGED_EVENT from the composer.)
              if (!out?.unchanged) toast?.show?.(out?.status === 'held' ? 'Saved. Your tip shows again once it is reviewed.' : 'Your tip is updated.');
            }}
          />
        </li>
      );
    }
    return (
      <li key={t.id} className="tip-item card" style={{ padding: 12, marginBottom: 10, listStyle: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
          {t.mine ? (
            <strong>Your tip</strong>
          ) : (
            <button
              type="button"
              className="link-button"
              aria-expanded={authorOpen === t.id}
              onClick={() => setAuthorOpen((o) => (o === t.id ? null : t.id))}
              style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 700, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
            >
              {t.authorName}
            </button>
          )}
          <span className="presence-line presence-verified" style={{ fontSize: '0.75rem' }}>
            {'✓'} Verified visit{month ? ` · ${month}` : ''}
            {t.edited ? ' · edited' : ''}
          </span>
        </div>
        {!t.mine && authorOpen === t.id && (
          <div style={{ marginTop: 6 }}>
            <FollowButton uid={t.authorUid} region={t.region || null} compact />
          </div>
        )}
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
                <>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingMine(true)} disabled={busy === 'mine:delete'}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={remove} disabled={busy === 'mine:delete'}>
                    Delete
                  </button>
                </>
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
        {/* At the bottom of the card: seen once the whole tip has scrolled
            into view. */}
        {!t.mine && <OnScreen onSeen={() => onTipSeen(t.id)} style={{ height: 2 }} aria-hidden="true" />}
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
      {confirmNode}
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
              // (The list reloads on TIPS_CHANGED_EVENT from the composer.)
              toast?.show?.(out?.status === 'held' ? 'Thanks! Your tip shows once it is reviewed.' : 'Thanks! Your tip is up.');
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
              {tipCheckin && user.emailVerified !== true ? ' Verify your email to share one.' : ''}
            </p>
          )}
        </>
      )}
    </div>
  );
}
