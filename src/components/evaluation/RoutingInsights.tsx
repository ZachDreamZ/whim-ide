import { useState } from 'react';

interface RoutingInsightData {
  selectedModel: string;
  taskClassification: string;
  reasons: string[];
  predictedQuality: number;
  costEstimate: number;
}

export const RoutingInsights: React.FC = () => {
  const [insight] = useState<RoutingInsightData>({
    selectedModel: 'Provider B / Model Y',
    taskClassification: 'TypeScript visual debugging',
    predictedQuality: 0.89,
    costEstimate: 0.045,
    reasons: [
      'Task classified as TypeScript visual debugging',
      'Tool calling required',
      '18 relevant historical samples in Evaluation DB',
      'Lower average correction loops than Model X'
    ]
  });

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-xl text-gray-300 max-w-lg mt-4 border border-gray-700">
      <h3 className="text-xl font-bold text-white mb-4">Routing Insights</h3>

      <div className="mb-4">
        <div className="text-sm text-gray-500">Selected Model</div>
        <div className="text-lg text-blue-400 font-semibold">{insight.selectedModel}</div>
      </div>

      <div className="mb-4">
        <div className="text-sm text-gray-500">Task Classification</div>
        <div className="text-md text-gray-200">{insight.taskClassification}</div>
      </div>

      <div className="mb-4">
        <div className="text-sm text-gray-500 mb-2">Routing Reasons</div>
        <ul className="list-disc list-inside space-y-1 text-sm text-gray-400">
          {insight.reasons.map((reason, idx) => (
            <li key={idx}>{reason}</li>
          ))}
        </ul>
      </div>

      <div className="flex gap-8 border-t border-gray-700 pt-4 mt-4">
        <div>
          <div className="text-xs text-gray-500">Predicted Quality</div>
          <div className="text-md text-green-400">{(insight.predictedQuality * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Estimated Cost</div>
          <div className="text-md text-yellow-400">${insight.costEstimate.toFixed(3)}</div>
        </div>
      </div>
    </div>
  );
};
