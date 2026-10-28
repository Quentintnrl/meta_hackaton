export interface ImageInfo {
  width: number;
  height: number;
  mime: 'image/png' | 'image/jpeg';
  ext: 'png' | 'jpeg';
}

// Reads the size from the file header. Returns null for anything that is not a PNG or a JPEG.
export function imageInfo(b: Buffer): ImageInfo | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), mime: 'image/png', ext: 'png' };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), mime: 'image/jpeg', ext: 'jpeg' };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

export const toDataUrl = (b: Buffer, mime: string) => `data:${mime};base64,${b.toString('base64')}`;

// "data:image/png;base64,...." from the console's file input.
export function fromDataUrl(url: string): Buffer | null {
  const m = url.match(/^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  return m ? Buffer.from(m[1], 'base64') : null;
}
