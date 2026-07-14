import { OcrEngineAdapter, OcrInput, OcrObservation } from './types';
import { getChangedRegions } from './differencing';
import { preprocessImage } from './preprocess';

export class OcrPipeline {
  private engine: OcrEngineAdapter;
  private previousFrameBuffer: Buffer | null = null;
  private cache: OcrObservation | null = null;

  constructor(engine: OcrEngineAdapter) {
    this.engine = engine;
  }

  async run(inputBuffer: Buffer, width: number, height: number): Promise<OcrObservation> {
    let shouldScan = true;

    if (this.previousFrameBuffer) {
      // 1. Differencing
      const changedRegions = await getChangedRegions(this.previousFrameBuffer, inputBuffer);
      if (changedRegions.length === 0) {
        shouldScan = false;
      }
    }

    if (!shouldScan && this.cache) {
      return this.cache;
    }

    // 2. Preprocess
    const processedBuffer = await preprocessImage(inputBuffer);

    // 3. ONNX Recognize
    const input: OcrInput = {
      imageBuffer: processedBuffer,
      width,
      height
    };

    const result = await this.engine.recognize(input);

    // 4. Cache result
    this.cache = result;
    this.previousFrameBuffer = inputBuffer;

    return result;
  }
}
