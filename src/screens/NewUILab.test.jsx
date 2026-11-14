// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import NewUILab from './NewUILab.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<NewUILab />));
  return container;
}

const click = (el) => act(async () => el.click());
const tab = (el, name) => [...el.querySelectorAll('.nui-seg [role="tab"]')].find((t) => t.textContent === name);

describe('New UI (Test tab)', () => {
  it('opens on Plan with one Mapr line and one gold button', async () => {
    const el = await render();
    expect(tab(el, 'Plan').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelectorAll('.nui-mapr')).toHaveLength(1);
    expect(el.querySelectorAll('.nui-btn-primary')).toHaveLength(1);
  });

  it('place cards show a reason, never a rating or price', async () => {
    const el = await render();
    const text = el.querySelector('.nui-row-scroll').textContent;
    expect(text).toContain('Because you liked');
    expect(text).not.toMatch(/★|\$|\d\.\d/);
  });

  it('opens a place, shows its fact with a source, and goes back', async () => {
    const el = await render();
    await click(el.querySelector('.nui-card'));
    expect(el.querySelector('.nui-hero-title').textContent).toBe('Statue of Liberty');
    expect(el.querySelector('.nui-source').getAttribute('href')).toMatch(/^https:\/\//);
    await click(el.querySelector('.nui-hero-back'));
    expect(tab(el, 'Plan').getAttribute('aria-selected')).toBe('true');
  });

  it('Trip shows progress as found of total', async () => {
    const el = await render();
    await click(tab(el, 'Trip'));
    expect(el.querySelector('.nui-ring').getAttribute('aria-label')).toBe('2 of 3 found');
  });

  it('follows the app theme, switches light and dark, and saves nothing', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const el = await render();
    const root = el.querySelector('.nui');
    expect(root.dataset.mode).toBe('dark');
    await click(el.querySelector('.nui-mode'));
    expect(root.dataset.mode).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.length).toBe(0);
  });
});
