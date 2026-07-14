import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function getChangedRegions(buffer1: Buffer, buffer2: Buffer): Promise<BoundingBox[]> {
  // Convert buffers to PNG objects for pixelmatch
  const img1 = PNG.sync.read(await sharp(buffer1).png().toBuffer());
  const img2 = PNG.sync.read(await sharp(buffer2).png().toBuffer());

  const width = img1.width;
  const height = img1.height;

  if (width !== img2.width || height !== img2.height) {
    throw new Error('Image dimensions do not match');
  }

  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(
    img1.data,
    img2.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 }
  );

  if (numDiffPixels === 0) {
    return [];
  }

  // Naive bounding box extraction for the changed regions
  let minX = width, minY = height, maxX = 0, maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4;
      // pixelmatch uses red (255, 0, 0) for diff pixels
      if (diff.data[idx] === 255 && diff.data[idx + 1] === 0 && diff.data[idx + 2] === 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Return one big bounding box for simplicity. In a real system, we'd cluster these.
  if (minX <= maxX && minY <= maxY) {
    return [{
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    }];
  }

  return [];
}
