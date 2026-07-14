import { useState } from 'react';

export function PerceptionSettings() {
    const [ocrEnabled, setOcrEnabled] = useState(true);
    const [ocrProfile, setOcrProfile] = useState("BALANCED");
    const [translationPolicy, setTranslationPolicy] = useState("TRANSLATE_UNSUPPORTED");

    return (
        <div className="flex flex-col gap-6 text-white p-6 bg-gray-900 rounded-lg max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold mb-4">Computer Use: Perception Settings</h2>

            <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-gray-700 pb-4">
                    <div>
                        <h3 className="text-lg font-medium">Enable Local OCR</h3>
                        <p className="text-sm text-gray-400">Run PP-OCRv6 models locally to perceive inaccessible UI elements.</p>
                    </div>
                    <input
                        type="checkbox"
                        checked={ocrEnabled}
                        onChange={(e) => setOcrEnabled(e.target.checked)}
                        className="w-5 h-5 rounded"
                    />
                </div>

                <div className="flex flex-col border-b border-gray-700 pb-4">
                    <h3 className="text-lg font-medium mb-2">OCR Profile</h3>
                    <select
                        className="bg-gray-800 border border-gray-700 text-white rounded p-2"
                        value={ocrProfile}
                        onChange={(e) => setOcrProfile(e.target.value)}
                    >
                        <option value="FAST">FAST (PP-OCRv6 Tiny) - Lowest latency</option>
                        <option value="BALANCED">BALANCED (PP-OCRv6 Small) - Recommended</option>
                        <option value="ACCURATE">ACCURATE (PP-OCRv6 Medium) - High accuracy</option>
                        <option value="DOCUMENT">DOCUMENT - Full layout awareness</option>
                    </select>
                </div>

                <div className="flex flex-col border-b border-gray-700 pb-4">
                    <h3 className="text-lg font-medium mb-2">Translation Policy</h3>
                    <select
                        className="bg-gray-800 border border-gray-700 text-white rounded p-2"
                        value={translationPolicy}
                        onChange={(e) => setTranslationPolicy(e.target.value)}
                    >
                        <option value="ALWAYS_TRANSLATE">Always Translate</option>
                        <option value="TRANSLATE_UNSUPPORTED">Translate Unsupported Languages (Recommended)</option>
                        <option value="NEVER_TRANSLATE">Never Translate</option>
                    </select>
                </div>

                <div className="pt-4 flex gap-4">
                    <button className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded">
                        Run OCR Benchmark
                    </button>
                    <button className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded">
                        Clear OCR Cache
                    </button>
                </div>
            </div>
        </div>
    );
}
