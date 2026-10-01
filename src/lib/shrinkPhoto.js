// Downscales a photo to a JPEG Blob small enough for Storage (storage.rules
// rejects uploads of 8 MB or more, and a modern phone photo can exceed that).
// Falls back to the original file whenever the browser can't decode it
// (HEIC, no canvas, etc.) -- never blocks an upload on the shrink step.
export async function shrinkPhoto(file, maxSize = 1600, quality = 0.82) {
  try {
    if (!file || typeof document === 'undefined' || typeof Image === 'undefined') return file;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onerror = reject;
      el.onload = () => resolve(el);
      el.src = dataUrl;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale) || 1;
    canvas.height = Math.round(img.height * scale) || 1;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    // Only swap in the shrunk copy when it actually helps.
    return blob && (blob.size < file.size || file.size >= 7 * 1024 * 1024) ? blob : file;
  } catch {
    return file;
  }
}
