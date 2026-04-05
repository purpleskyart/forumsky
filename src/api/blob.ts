import { xrpcUploadBlob } from './xrpc';
import type { AtprotoBlobRef, EmbedRecord } from './types';

/** Bluesky allows up to four images per post. */
export const MAX_IMAGES_PER_POST = 4;
/** Conservative limit for PDS blob uploads (bytes). */
export const MAX_IMAGE_BYTES = 1_000_000;

const ACCEPT_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** JPEG / PNG / GIF / WebP only (Bluesky-supported). */
export function isAcceptedImageFile(file: File): boolean {
  const mime = file.type;
  return Boolean(mime) && ACCEPT_MIME.has(mime);
}

export function buildImagesEmbed(blobs: AtprotoBlobRef[], alts?: string[]): EmbedRecord {
  return {
    $type: 'app.bsky.embed.images',
    images: blobs.map((blob, i) => {
      const image =
        blob.$type === 'blob'
          ? blob
          : { $type: 'blob' as const, ref: blob.ref, mimeType: blob.mimeType, size: blob.size };
      const alt = (alts?.[i] ?? '').trim();
      return { alt, image };
    }),
  };
}

export async function uploadImageFile(file: File): Promise<AtprotoBlobRef> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Each image must be ≤ ${MAX_IMAGE_BYTES / 1000}KB`);
  }
  const mime = file.type || 'image/jpeg';
  if (!mime.startsWith('image/') || !ACCEPT_MIME.has(mime)) {
    throw new Error('Use JPEG, PNG, GIF, or WebP');
  }
  const buf = await file.arrayBuffer();
  const { blob } = await xrpcUploadBlob(buf, mime);
  return blob;
}

export async function uploadImageFiles(files: File[]): Promise<AtprotoBlobRef[]> {
  const refs: AtprotoBlobRef[] = [];
  for (const f of files) {
    refs.push(await uploadImageFile(f));
  }
  return refs;
}
