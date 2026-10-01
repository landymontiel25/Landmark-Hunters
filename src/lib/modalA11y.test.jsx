// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { installModalA11y } from './modalA11y';
import { titleForPath } from './useDocumentTitle';

const tick = () => new Promise((r) => setTimeout(r, 0));

function openModal(onClose) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', () => {
    onClose?.();
    backdrop.remove();
  });
  backdrop.innerHTML =
    '<div class="modal-card"><h2>Change password</h2><input id="a" /><button id="b">Save</button></div>';
  document.body.appendChild(backdrop);
  return backdrop;
}

describe('installModalA11y', () => {
  let off;
  afterEach(() => {
    off?.();
    document.body.innerHTML = '';
  });

  it('labels the dialog, moves focus in, closes on Escape and restores focus', async () => {
    off = installModalA11y();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    let closed = 0;
    openModal(() => closed++);
    await tick();
    const card = document.querySelector('.modal-card');
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(card.getAttribute('aria-labelledby')).textContent).toBe('Change password');
    expect(document.activeElement).toBe(card);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await tick();
    expect(closed).toBe(1);
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside the dialog', async () => {
    off = installModalA11y();
    openModal();
    await tick();
    const last = document.getElementById('b');
    last.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('a'));
  });

  it('keeps a name the modal already has', async () => {
    off = installModalA11y();
    const b = openModal();
    b.firstElementChild.setAttribute('aria-label', 'Your Mapr chats');
    b.firstElementChild.setAttribute('role', 'dialog');
    await tick();
    expect(b.firstElementChild.getAttribute('aria-labelledby')).toBeNull();
  });
});

describe('titleForPath', () => {
  it('names each screen', () => {
    expect(titleForPath('/')).toBe('Map · Landmark Hunters');
    expect(titleForPath('/landmarks/miami/south-beach')).toBe('Landmark · Landmark Hunters');
    expect(titleForPath('/leaderboard/full')).toBe('Leaderboard · Landmark Hunters');
    expect(titleForPath('/nope')).toBe('Landmark Hunters');
  });
});
