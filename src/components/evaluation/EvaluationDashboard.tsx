import { useState } from 'react';

// The Dashboard should only be fully imported/rendered when WHIM_EVALUATION is explicitly set
// to prevent inflating the production bundle with testing metrics.

interface ModelMetric {
  modelId: string;
  taskType: string;
  successRate: number;
  averageLatencyMs: number;
}

export const EvaluationDashboard: React.FC = () => {
  const [metrics] = useState<ModelMetric[]>([
    { modelId: 'provider-a/model-x', taskType: 'visual_debugging', successRate: 0.88, averageLatencyMs: 12050 },
    { modelId: 'provider-b/model-y', taskType: 'code_editing', successRate: 0.94, averageLatencyMs: 8400 }
  ]);

  return (
    <div className="p-6 bg-gray-900 text-gray-200 min-h-screen">
      <h1 className="text-2xl font-bold text-white mb-6">Evaluation Dashboard</h1>
      <div className="grid grid-cols-2 gap-4">
        {metrics.map((m, idx) => (
          <div key={idx} className="bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-700">
            <h2 className="text-lg font-semibold text-blue-400 mb-2">{m.modelId}</h2>
            <div className="text-sm text-gray-400 mb-4">Task: {m.taskType}</div>

            <div className="flex justify-between items-center mb-2">
              <span className="text-sm">Success Rate</span>
              <span className="font-mono text-green-400">{(m.successRate * 100).toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
              <div className="bg-green-500 h-2 rounded-full" style={{ width: `${m.successRate * 100}%` }}></div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm">Avg Latency</span>
              <span className="font-mono text-yellow-400">{m.averageLatencyMs} ms</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
