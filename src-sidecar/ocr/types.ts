export interface OcrInput {
  imageBuffer: Buffer;
  width: number;
  height: number;
}

export interface DetectedTextRegion {
  text: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OcrObservation {
  regions: DetectedTextRegion[];
  timestamp: number;
  durationMs: number;
}

export interface OcrEngineHealth {
  isReady: boolean;
  modelLoaded: boolean;
  error?: string;
}

export interface OcrBenchmarkResult {
  averageInferenceTimeMs: number;
  throughputFps: number;
  memoryUsageMb: number;
}

export interface OcrEngineAdapter {
  init(): Promise<void>;
  recognize(input: OcrInput): Promise<OcrObservation>;
  getHealth(): Promise<OcrEngineHealth>;
  benchmark?(): Promise<OcrBenchmarkResult>;
}
