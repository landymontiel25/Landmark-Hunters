// One place that gives every `.modal-backdrop` dialog the behaviour screen
// reader and keyboard users expect, instead of ~25 hand-rolled copies:
// role="dialog" + aria-modal + a name, focus moved in on open and put back on
// the opener on close, Tab kept inside, and Escape closing the top one (by
// clicking its backdrop, which every modal already wires to its own close).

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let idSeq = 0;

function visible(el) {
  return !el.hidden && el.getAttribute('aria-hidden') !== 'true';
}

// Returns false when the backdrop has no dialog child yet, so a later pass
// can try again instead of leaving it undecorated for good.
function decorate(backdrop, stack, history, doc) {
  const dialog = backdrop.firstElementChild;
  if (!dialog) return false;
  if (!dialog.getAttribute('role')) dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
  if (!dialog.getAttribute('aria-label') && !dialog.getAttribute('aria-labelledby')) {
    const heading = dialog.querySelector('h1,h2,h3,h4');
    if (heading) {
      if (!heading.id) heading.id = `modal-title-${++idSeq}`;
      dialog.setAttribute('aria-labelledby', heading.id);
    }
  }
  // The opener is the last thing focused/pressed before this modal appeared.
  // document.activeElement is too late: a modal with an autofocus field has
  // already moved focus into itself by the time the observer runs, and focus
  // would then be "returned" to a node that is about to be removed.
  let opener = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const el = history[i];
    if (el.isConnected && !backdrop.contains(el)) {
      opener = el;
      break;
    }
  }
  stack.push({ backdrop, dialog, opener });
  if (!dialog.contains(doc.activeElement)) dialog.focus({ preventScroll: true });
  return true;
}

const OPENER = 'button,a[href],input,select,textarea,summary,[role="button"],[tabindex]';

export function installModalA11y(doc = document) {
  const stack = [];
  const seen = new WeakSet();
  const history = [];
  const remember = (el) => {
    if (!el || el === doc.body || el.nodeType !== 1) return;
    if (history[history.length - 1] === el) return;
    history.push(el);
    if (history.length > 8) history.shift();
  };
  // Focus covers keyboard; the press covers Safari/iOS, where tapping a
  // button does not focus it.
  const onFocusIn = (e) => remember(e.target);
  const onPress = (e) => remember(e.target.closest?.(OPENER));

  const sync = () => {
    doc.querySelectorAll('.modal-backdrop').forEach((b) => {
      if (seen.has(b)) return;
      if (decorate(b, stack, history, doc)) seen.add(b);
    });
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i];
      if (entry.backdrop.isConnected) continue;
      stack.splice(i, 1);
      const { opener } = entry;
      const active = doc.activeElement;
      if (opener && opener.isConnected && (!active || active === doc.body)) {
        opener.focus({ preventScroll: true });
      }
    }
  };

  const onKey = (e) => {
    const top = stack[stack.length - 1];
    if (!top || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      // Don't close a modal mid-IME or behind the lightbox (which closes
      // itself on Escape).
      if (e.isComposing || doc.body.classList.contains('lightbox-open')) return;
      e.preventDefault();
      top.backdrop.click();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...top.dialog.querySelectorAll(FOCUSABLE)].filter(visible);
    if (!items.length) {
      e.preventDefault();
      top.dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = doc.activeElement;
    if (!top.dialog.contains(active) || active === top.dialog) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const mo = new MutationObserver(sync);
  mo.observe(doc.body, { childList: true, subtree: true });
  // On window, after every document-level Escape handler (menus, popovers)
  // has had its chance to claim the key with preventDefault.
  const win = doc.defaultView || window;
  win.addEventListener('keydown', onKey);
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('pointerdown', onPress, true);
  remember(doc.activeElement);
  sync();
  return () => {
    mo.disconnect();
    win.removeEventListener('keydown', onKey);
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('pointerdown', onPress, true);
  };
}
