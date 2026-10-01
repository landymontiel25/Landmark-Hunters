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

function decorate(backdrop, stack) {
  const dialog = backdrop.firstElementChild;
  if (!dialog) return;
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
  const opener = document.activeElement;
  stack.push({ backdrop, dialog, opener });
  if (!dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
}

export function installModalA11y(doc = document) {
  const stack = [];
  const seen = new WeakSet();

  const sync = () => {
    doc.querySelectorAll('.modal-backdrop').forEach((b) => {
      if (seen.has(b)) return;
      seen.add(b);
      decorate(b, stack);
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
  doc.addEventListener('keydown', onKey);
  sync();
  return () => {
    mo.disconnect();
    doc.removeEventListener('keydown', onKey);
  };
}
