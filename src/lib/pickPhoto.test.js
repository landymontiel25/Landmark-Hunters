import { describe, it, expect, vi, beforeEach } from 'vitest';

const getPhoto = vi.fn();
vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: (...a) => getPhoto(...a) },
  CameraResultType: { Uri: 'uri' },
  CameraSource: { Prompt: 'PROMPT' },
}));

import { pickPhoto } from './imageUtils';

beforeEach(() => {
  getPhoto.mockReset();
});

describe('pickPhoto', () => {
  it('returns null when the user cancels', async () => {
    getPhoto.mockImplementation(() => Promise.reject(new Error('User cancelled photos app')));
    await expect(pickPhoto()).resolves.toBeNull();
  });
  it('explains a denied camera/photos permission instead of doing nothing', async () => {
    getPhoto.mockImplementation(() => Promise.reject(new Error('User denied access to camera')));
    await expect(pickPhoto()).rejects.toMatchObject({ userMessage: expect.stringMatching(/Settings/i) });
  });
});
