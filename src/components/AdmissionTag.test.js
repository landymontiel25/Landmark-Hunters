import { describe, it, expect } from 'vitest';
import { admissionText } from './AdmissionTag';

describe('admissionText', () => {
  it('free places', () => {
    expect(admissionText({ free: true, categories: ['art'] })).toBe('Free to Visit');
    expect(admissionText({ free: true }, true)).toBe('Free');
  });
  it('ticketed attractions say a ticket is needed', () => {
    expect(admissionText({ free: false, categories: ['art'] })).toBe('Needs a ticket');
  });
  it('restaurants are never labelled ticketed', () => {
    expect(admissionText({ free: false, categories: ['food'] })).toBeNull();
  });
  it('an unknown fee makes no claim', () => {
    expect(admissionText({ free: null, categories: ['parks-nature'] })).toBeNull();
    expect(admissionText({ categories: ['local-life'] })).toBeNull();
  });
});
