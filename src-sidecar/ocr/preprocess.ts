import sharp from 'sharp';

export async function preprocessImage(imageBuffer: Buffer, targetWidth?: number, targetHeight?: number): Promise<Buffer> {
  let sharpInstance = sharp(imageBuffer)
    .grayscale(); // Grayscale conversion

  if (targetWidth && targetHeight) {
    // Upscale / resize and pad
    sharpInstance = sharpInstance.resize({
      width: targetWidth,
      height: targetHeight,
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 } // Padding with white
    });
  }

  return sharpInstance.png().toBuffer();
}
