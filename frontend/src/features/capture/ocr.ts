// Screenshot -> on-device OCR. The image is read into memory, handed to the native plugin
// (ML Kit / Apple Vision) and dropped; it is never uploaded or written anywhere.
import { captureEnv, type OcrPluginResult } from '../../native/capture';
import type { OcrImage } from './types';

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('Could not read the image'));
    r.onload = () => {
      const s = String(r.result || '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.readAsDataURL(b);
  });
}

/** Flatten blocks to lines; lines are what segmentation works on. */
export function toOcrImage(r: OcrPluginResult): OcrImage {
  return {
    width: r.width,
    height: r.height,
    lines: r.blocks.flatMap((b) => b.lines).filter((l) => l.text && l.w > 0 && l.h > 0),
  };
}

export async function recognizeScreenshot(file: Blob): Promise<OcrImage> {
  const base64 = await blobToBase64(file);
  const r = await captureEnv().ocr().recognize({ base64 });
  return toOcrImage(r);
}
