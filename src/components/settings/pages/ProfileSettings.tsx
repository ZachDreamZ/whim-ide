import { Share, Lock, Edit3 } from "lucide-react";

export function ProfileSettings() {
  // Generate mock heatmap data (just an array of 52 weeks * 7 days)
  const heatmapData = Array.from({ length: 52 * 7 }, (_, i) => {
    // Make the last few days have some activity to match the screenshot
    const isRecent = i > 52 * 7 - 14;
    return isRecent ? Math.floor(Math.random() * 4) : 0;
  });

  return (
    <div className="max-w-[850px] mx-auto px-10 py-12 text-[#ececf1]">
      <div className="flex items-center justify-between mb-16">
        <h1 className="text-2xl font-medium text-white">Profile</h1>
        <div className="flex items-center gap-4 text-[13px] font-medium text-[#a3a3a3]">
          <button className="flex items-center gap-1.5 hover:text-white transition-colors"><Share size={14} /> Share</button>
          <button className="flex items-center gap-1.5 hover:text-white transition-colors"><Lock size={14} /> Private</button>
          <button className="flex items-center gap-1.5 hover:text-white transition-colors"><Edit3 size={14} /> Edit</button>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center mb-12">
        <div className="w-20 h-20 rounded-full bg-[#f1c40f] text-white flex items-center justify-center text-3xl font-medium mb-4">
          CE
        </div>
        <h2 className="text-2xl font-medium text-white mb-1">Carl Andrie Ellepure</h2>
        <div className="text-sm text-[#a3a3a3]">
          @xxtheshadowcraft · <span className="bg-white/10 px-1.5 py-0.5 rounded text-[11px] ml-1">Plus</span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 bg-white/[0.02] border border-white/5 rounded-xl p-4 mb-10 text-center divide-x divide-white/5">
        <div>
          <div className="text-lg font-semibold text-white mb-1">1B</div>
          <div className="text-xs text-[#a3a3a3]">Lifetime tokens</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-white mb-1">123.2M</div>
          <div className="text-xs text-[#a3a3a3]">Peak tokens</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-white mb-1">1h 37m</div>
          <div className="text-xs text-[#a3a3a3]">Longest task</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-white mb-1">3 days</div>
          <div className="text-xs text-[#a3a3a3]">Current streak</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-white mb-1">5 days</div>
          <div className="text-xs text-[#a3a3a3]">Longest streak</div>
        </div>
      </div>

      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Token activity</h3>
          <div className="flex items-center gap-3 text-xs text-[#a3a3a3]">
            <button className="text-white">Daily</button>
            <button className="hover:text-white">Weekly</button>
            <button className="hover:text-white">Cumulative</button>
          </div>
        </div>
        
        <div className="w-full overflow-hidden">
          <div className="flex flex-col gap-[3px] opacity-70">
            {/* 7 rows for days of week */}
            {Array.from({ length: 7 }).map((_, rowIndex) => (
              <div key={rowIndex} className="flex gap-[3px]">
                {Array.from({ length: 52 }).map((_, colIndex) => {
                  const val = heatmapData[colIndex * 7 + rowIndex];
                  let bg = "bg-[#2f2f2f]";
                  if (val === 1) bg = "bg-[#0e4429]";
                  if (val === 2) bg = "bg-[#006d32]";
                  if (val === 3) bg = "bg-[#26a641]";
                  if (val === 4) bg = "bg-[#39d353]";
                  
                  // Use blue tones to match screenshot exactly
                  if (val === 1) bg = "bg-[#0c3a5e]";
                  if (val === 2) bg = "bg-[#19619a]";
                  if (val === 3) bg = "bg-[#2b8cd7]";
                  if (val === 4) bg = "bg-[#6cbdfa]";

                  return (
                    <div 
                      key={colIndex} 
                      className={`w-[11px] h-[11px] rounded-sm ${bg}`} 
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-[#a3a3a3] mt-2 px-1 uppercase">
            <span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span>
            <span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span>
            <span>Jun</span><span>Jul</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-16">
        <div>
          <h3 className="text-sm font-semibold mb-4">Activity insights</h3>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between"><span className="text-[#a3a3a3]">Fast Mode</span><span>8%</span></div>
            <div className="flex justify-between"><span className="text-[#a3a3a3]">Most used reasoning</span><span>Medium · 38%</span></div>
            <div className="flex justify-between"><span className="text-[#a3a3a3]">Skills explored</span><span>1</span></div>
            <div className="flex justify-between"><span className="text-[#a3a3a3]">Total skills used</span><span>1</span></div>
            <div className="flex justify-between"><span className="text-[#a3a3a3]">Total tasks</span><span>1,112</span></div>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-4">Most used plugins</h3>
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 bg-gradient-to-tr from-purple-500 to-orange-400 rounded-sm"></span>
              $plugin-creator
            </div>
            <span className="text-[#a3a3a3]">1 run</span>
          </div>
        </div>
      </div>
    </div>
  );
}
