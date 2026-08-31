'use client';

interface SettingsSlidersProps {
  // Label size
  labelSize: number;
  onLabelSizeChange: (size: number) => void;

  // Dot scale
  dotScale: number;
  onDotScaleChange: (scale: number) => void;
  dotScaleMode: 'logarithmic' | 'linear';
  onToggleDotScaleMode: () => void;

  // Which sliders to show
  showLabelSize?: boolean;
  showDotScale?: boolean;
}

export function SettingsSliders({
  labelSize,
  onLabelSizeChange,
  dotScale,
  onDotScaleChange,
  dotScaleMode,
  onToggleDotScaleMode,
  showLabelSize = true,
  showDotScale = true,
}: SettingsSlidersProps) {
  return (
    <div className="space-y-4">
      {/* Label Size Slider */}
      {showLabelSize && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-semibold text-ink-light uppercase tracking-wider">
              Label Size
            </label>
            <span className="text-xs font-medium text-ink">{labelSize}px</span>
          </div>
          <input
            type="range"
            min={10}
            max={20}
            step={1}
            value={labelSize}
            onChange={(e) => onLabelSizeChange(Number(e.target.value))}
            className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-green"
          />
          <div className="flex justify-between text-[9px] text-ink-muted mt-0.5">
            <span>10px</span>
            <span>20px</span>
          </div>
        </div>
      )}

      {/* Dot Scale Slider */}
      {showDotScale && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-semibold text-ink-light uppercase tracking-wider">
              Dot Scale
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-ink">{dotScale.toFixed(1)}x</span>
              <button
                onClick={onToggleDotScaleMode}
                className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-surface text-ink-light hover:bg-surface-warm transition"
              >
                {dotScaleMode === 'logarithmic' ? 'Log' : 'Linear'}
              </button>
            </div>
          </div>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={dotScale}
            onChange={(e) => onDotScaleChange(Number(e.target.value))}
            className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-green"
          />
          <div className="flex justify-between text-[9px] text-ink-muted mt-0.5">
            <span>0.5x</span>
            <span>2.0x</span>
          </div>
        </div>
      )}
    </div>
  );
}
