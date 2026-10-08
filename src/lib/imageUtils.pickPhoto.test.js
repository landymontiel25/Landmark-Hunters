import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: vi.fn() },
  CameraResultType: { Uri: 'uri' },
  CameraSource: { Prompt: 'PROMPT' },
}));

import { Camera } from '@capacitor/camera';
import { pickPhoto } from './imageUtils';

afterEach(() => vi.restoreAllMocks());

describe('pickPhoto', () => {
  it('revokes the web fallback blob: URL after reading it', async () => {
    Camera.getPhoto.mockResolvedValue({ webPath: 'blob:http://x/abc', format: 'jpeg' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ blob: async () => new Blob(['x'], { type: 'image/jpeg' }) });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const file = await pickPhoto();
    expect(file).toBeInstanceOf(File);
    expect(revoke).toHaveBeenCalledWith('blob:http://x/abc');
  });

  it('leaves a native (non-blob) webPath alone', async () => {
    Camera.getPhoto.mockResolvedValue({ webPath: 'capacitor://localhost/_capacitor_file_/p.jpg', format: 'jpeg' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ blob: async () => new Blob(['x'], { type: 'image/jpeg' }) });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await pickPhoto();
    expect(revoke).not.toHaveBeenCalled();
  });
});
