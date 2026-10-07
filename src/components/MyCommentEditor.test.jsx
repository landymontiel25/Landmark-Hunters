// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act, useState } from 'react';

const saveMyComment = vi.fn(async ({ comment }) => comment.trim());
vi.mock('../lib/reviews', () => ({ saveMyComment: (...a) => saveMyComment(...a) }));

import MyCommentEditor from './MyCommentEditor';

let container;
afterEach(() => {
  document.body.removeChild(container);
  saveMyComment.mockClear();
});

async function mount(el) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(el));
}

const click = (text) =>
  act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text)).click());

async function type(value) {
  const ta = container.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => {
    setter.call(ta, value);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const landmark = { id: 'lm1', name: 'Shooting Range', region: 'philly' };

describe('MyCommentEditor', () => {
  it('adds a comment to a check-in that had none', async () => {
    await mount(<MyCommentEditor userId="me" landmark={landmark} comment="" tier="worth-trying" />);
    await click('Add a comment');
    await type('Great instructors');
    await click('Save');
    expect(saveMyComment).toHaveBeenCalledWith({
      userId: 'me',
      userName: undefined,
      landmark,
      comment: 'Great instructors',
      tier: 'worth-trying',
    });
    expect(container.textContent).toContain('Great instructors');
    expect(container.textContent).toContain('Edit comment');
  });

  it('edits an existing comment, starting from what was there', async () => {
    const onSaved = vi.fn();
    await mount(<MyCommentEditor userId="me" landmark={landmark} comment="Fun" tier="highly-recommend" onSaved={onSaved} />);
    await click('Edit comment');
    expect(container.querySelector('textarea').value).toBe('Fun');
    await type('Fun. Bring ear protection.');
    await click('Save');
    expect(onSaved).toHaveBeenCalledWith('Fun. Bring ear protection.');
    expect(container.textContent).toContain('Bring ear protection');
  });

  it('keeps the text and shows an error when saving fails', async () => {
    saveMyComment.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission-denied' }));
    await mount(<MyCommentEditor userId="me" landmark={landmark} comment="" tier="worth-trying" />);
    await click('Add a comment');
    await type('Draft text');
    await click('Save');
    expect(container.querySelector('textarea').value).toBe('Draft text');
    expect(container.querySelector('.tag-error')).not.toBeNull();
  });

  it('without a tier on file it asks for one first and saves the comment together with it', async () => {
    await mount(<MyCommentEditor userId="me" userName="Me" landmark={landmark} comment="old legacy note" tier={null} />);
    await click('Edit comment');
    const save = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save');
    // Three tiers offered, Save blocked until one is picked.
    expect(container.textContent).toContain('I loved it');
    expect(container.textContent).toContain('Ok');
    expect(container.textContent).toContain("I didn't like it");
    expect(save().disabled).toBe(true);
    await click("I didn't like it");
    expect(save().disabled).toBe(false);
    await click('Save');
    expect(saveMyComment).toHaveBeenCalledWith({
      userId: 'me',
      userName: 'Me',
      landmark,
      comment: 'old legacy note',
      tier: 'probably-skip',
    });
  });

  it('does not show the tier picker when the review already has one', async () => {
    await mount(<MyCommentEditor userId="me" landmark={landmark} comment="Fun" tier="highly-recommend" />);
    await click('Edit comment');
    expect(container.querySelector('.rating-tier')).toBeNull();
  });

  it('shows the newest comment when another row for the same place was edited later', async () => {
    // Two check-in rows for one place share one comment (CheckinsGallery).
    function TwoRows() {
      const [comment, setComment] = useState('');
      return (
        <>
          <div id="a"><MyCommentEditor userId="me" landmark={landmark} comment={comment} tier="worth-trying" onSaved={setComment} /></div>
          <div id="b"><MyCommentEditor userId="me" landmark={landmark} comment={comment} tier="worth-trying" onSaved={setComment} /></div>
        </>
      );
    }
    await mount(<TwoRows />);
    const row = (id) => container.querySelector(`#${id}`);
    const clickIn = (id, text) =>
      act(async () => [...row(id).querySelectorAll('button')].find((b) => b.textContent.includes(text)).click());
    await clickIn('a', 'Add a comment');
    await type('First');
    await clickIn('a', 'Save');
    await clickIn('b', 'Edit comment');
    await type('Second');
    await clickIn('b', 'Save');
    expect(row('a').textContent).toContain('Second');
    expect(row('a').textContent).not.toContain('First');
  });
});
