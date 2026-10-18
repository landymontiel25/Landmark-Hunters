// @vitest-environment jsdom
// Owner report 2026-10-18: Miami Seaquarium is closed but its cards still
// read like an open attraction.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AdmissionTag, { admissionText } from './AdmissionTag';
import LandmarkThumb from './LandmarkThumb';
import { getLandmark } from '../data/regions';

describe('closed places', () => {
  it('Miami Seaquarium is marked closed in the data', () => {
    expect(getLandmark('miami', 'miami-seaquarium')?.permanentlyClosed).toBe(true);
  });

  it('cards say CLOSED instead of the ticket tag', () => {
    const l = { id: 'x', name: 'X', free: false, categories: ['entertainment'], permanentlyClosed: true };
    expect(admissionText(l)).toBe('CLOSED');
    expect(renderToStaticMarkup(<AdmissionTag landmark={l} />)).toContain('CLOSED');
    expect(renderToStaticMarkup(<LandmarkThumb landmark={l} />)).toContain('CLOSED');
    expect(renderToStaticMarkup(<LandmarkThumb landmark={{ ...l, permanentlyClosed: false }} />)).not.toContain('CLOSED');
  });
});
