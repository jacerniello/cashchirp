'use client';

import { useState } from 'react';
import { Icon } from '../../icons';
import type { LineConfig } from '../hooks/useLineSettings';

interface LineValue {
  value: number | null;
  label?: string;
}

interface LineControlPanelProps {
  lines: LineConfig[];
  lineValues?: Map<string, LineValue>;
  onToggleVisibility: (id: string) => void;
  onToggleFill: (id: string) => void;
  onToggleDots: (id: string) => void;
  onSetColor: (id: string, color: string) => void;
  onSetScale: (id: string, scale: 'combined' | 'individual') => void;
  onSetSmoothing: (id: string, smoothing: number) => void;
  onRemoveLine?: (id: string) => void;
}

interface LineItemProps {
  line: LineConfig;
  value?: LineValue;
  onToggleVisibility: () => void;
  onToggleFill: () => void;
  onToggleDots: () => void;
  onSetColor: (color: string) => void;
  onSetScale: (scale: 'combined' | 'individual') => void;
  onSetSmoothing: (smoothing: number) => void;
  onRemove?: () => void;
}

// Helper to format values (handles negative values)
const formatValue = (val: number): string => {
  const absVal = Math.abs(val);
  if (absVal >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
  if (absVal >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (absVal >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
};

function LineItem({
  line,
  value,
  onToggleVisibility,
  onToggleFill,
  onToggleDots,
  onSetColor,
  onSetScale,
  onSetSmoothing,
  onRemove,
}: LineItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border transition-all inline-block min-w-[180px] max-w-[280px] ${
        line.visible
          ? 'bg-white border-rule'
          : 'bg-surface border-transparent opacity-60'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 p-2">
        {/* Color indicator */}
        <div
          className="w-4 h-4 rounded cursor-pointer border border-rule"
          style={{ backgroundColor: line.color }}
          onClick={() => {
            // Open color picker (simple implementation)
            const input = document.createElement('input');
            input.type = 'color';
            input.value = line.color;
            input.addEventListener('change', (e) => {
              onSetColor((e.target as HTMLInputElement).value);
            });
            input.click();
          }}
          title="Click to change color"
        />

        {/* Line name and value */}
        <div className="flex-1 min-w-0">
          <span
            className={`block text-xs font-semibold truncate cursor-pointer ${
              line.visible ? 'text-ink' : 'text-ink-muted'
            }`}
            onClick={onToggleVisibility}
          >
            {line.name}
          </span>
          {value && value.value !== null && line.visible && (
            <span
              className="block text-sm font-bold tabular-nums"
              style={{ color: line.color }}
            >
              {value.label || ''}{formatValue(value.value)}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {/* Visibility toggle */}
          <button
            onClick={onToggleVisibility}
            className={`p-1 rounded transition ${
              line.visible
                ? 'text-green hover:bg-green-soft'
                : 'text-ink-muted hover:bg-surface'
            }`}
            title={line.visible ? 'Hide line' : 'Show line'}
          >
            <Icon name={line.visible ? 'eye' : 'eye-off'} className="w-3.5 h-3.5" />
          </button>

          {/* Settings expand */}
          <button
            onClick={() => setExpanded(!expanded)}
            className={`p-1 rounded transition ${
              expanded
                ? 'text-green bg-green-soft'
                : 'text-ink-muted hover:bg-surface'
            }`}
            title="Settings"
          >
            <Icon name="settings" className="w-3.5 h-3.5" />
          </button>

          {/* Remove button */}
          {onRemove && (
            <button
              onClick={onRemove}
              className="p-1 rounded text-ink-muted hover:text-red hover:bg-red-soft transition"
              title="Remove line"
            >
              <Icon name="close" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded settings */}
      {expanded && line.visible && (
        <div className="px-2 pb-2 pt-1 border-t border-rule-light">
          <div className="grid grid-cols-2 gap-2">
            {/* Fill toggle */}
            <label className="flex items-center gap-1.5 text-[10px] text-ink-light cursor-pointer">
              <input
                type="checkbox"
                checked={line.fill}
                onChange={onToggleFill}
                className="w-3 h-3 accent-green"
              />
              Fill
            </label>

            {/* Dots toggle */}
            <label className="flex items-center gap-1.5 text-[10px] text-ink-light cursor-pointer">
              <input
                type="checkbox"
                checked={line.showDots}
                onChange={onToggleDots}
                className="w-3 h-3 accent-green"
              />
              Dots
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            {/* Scale select */}
            <div>
              <label className="text-[9px] font-semibold text-ink-light uppercase">
                Scale
              </label>
              <select
                value={line.scale}
                onChange={(e) => onSetScale(e.target.value as 'combined' | 'individual')}
                className="w-full mt-0.5 text-[10px] py-1 px-1.5 bg-surface border border-rule-light rounded"
              >
                <option value="combined">Combined</option>
                <option value="individual">Individual</option>
              </select>
            </div>

            {/* Smoothing select */}
            <div>
              <label className="text-[9px] font-semibold text-ink-light uppercase">
                Smoothing
              </label>
              <select
                value={line.smoothing}
                onChange={(e) => onSetSmoothing(Number(e.target.value))}
                className="w-full mt-0.5 text-[10px] py-1 px-1.5 bg-surface border border-rule-light rounded"
              >
                <option value={1}>None</option>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function LineControlPanel({
  lines,
  lineValues,
  onToggleVisibility,
  onToggleFill,
  onToggleDots,
  onSetColor,
  onSetScale,
  onSetSmoothing,
  onRemoveLine,
}: LineControlPanelProps) {
  // Default to expanded so users can see line controls immediately
  const [isExpanded, setIsExpanded] = useState(true);

  if (lines.length === 0) return null;

  return (
    <div className="border-t border-rule-light">
      {/* Toggle header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left bg-surface-warm hover:bg-surface transition"
      >
        <span className="text-xs font-semibold text-ink-light">
          Lines ({lines.length})
        </span>
        <Icon
          name="chevron-down"
          className={`w-4 h-4 text-ink-muted transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Line list */}
      {isExpanded && (
        <div className="p-3 flex flex-wrap gap-2 bg-surface">
          {lines.map((line) => (
            <LineItem
              key={line.id}
              line={line}
              value={lineValues?.get(line.id)}
              onToggleVisibility={() => onToggleVisibility(line.id)}
              onToggleFill={() => onToggleFill(line.id)}
              onToggleDots={() => onToggleDots(line.id)}
              onSetColor={(color) => onSetColor(line.id, color)}
              onSetScale={(scale) => onSetScale(line.id, scale)}
              onSetSmoothing={(smoothing) => onSetSmoothing(line.id, smoothing)}
              onRemove={onRemoveLine ? () => onRemoveLine(line.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
