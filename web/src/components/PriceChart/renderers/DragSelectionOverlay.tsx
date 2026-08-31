'use client';

interface DragSelection {
  startX: number;
  endX: number;
}

interface DragSelectionOverlayProps {
  selection: DragSelection | null;
  isDragging: boolean;
  showConfirm: boolean;
  paddingTop: number;
  paddingLeft: number;
  priceChartHeight: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DragSelectionOverlay({
  selection,
  isDragging,
  showConfirm,
  paddingTop,
  paddingLeft,
  priceChartHeight,
  onConfirm,
  onCancel,
}: DragSelectionOverlayProps) {
  if (!selection) return null;

  const selectionWidth = Math.abs(selection.endX - selection.startX);
  const selectionX = Math.min(selection.startX, selection.endX);

  // Calculate button position - center in selection but ensure it stays within chart area
  const buttonWidth = 120;
  const idealX = selectionX + selectionWidth / 2 - buttonWidth / 2;
  const buttonX = Math.max(paddingLeft, idealX);

  return (
    <g className="drag-selection">
      {/* Selection rectangle */}
      <rect
        x={selectionX}
        y={paddingTop}
        width={selectionWidth}
        height={priceChartHeight}
        fill="var(--color-green)"
        opacity={isDragging ? 0.1 : 0.15}
        stroke="var(--color-green)"
        strokeWidth={isDragging ? 0 : 1}
        strokeDasharray={isDragging ? undefined : '4 2'}
      />

      {/* Selection edge lines */}
      <line
        x1={selection.startX}
        y1={paddingTop}
        x2={selection.startX}
        y2={paddingTop + priceChartHeight}
        stroke="var(--color-green)"
        strokeWidth={2}
        opacity={0.7}
      />
      <line
        x1={selection.endX}
        y1={paddingTop}
        x2={selection.endX}
        y2={paddingTop + priceChartHeight}
        stroke="var(--color-green)"
        strokeWidth={2}
        opacity={0.7}
      />

      {/* Confirmation buttons (shown after drag ends) */}
      {showConfirm && (
        <foreignObject
          x={buttonX}
          y={paddingTop + priceChartHeight / 2 - 20}
          width={buttonWidth}
          height={40}
          className="overflow-visible"
        >
          <div
            // @ts-expect-error - xmlns needed for foreignObject HTML content
            xmlns="http://www.w3.org/1999/xhtml"
            onMouseDown={(e) => e.stopPropagation()}
            className="flex gap-1.5 justify-center w-full h-full items-center"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onConfirm();
              }}
              className="py-1.5 px-2.5 text-[11px] font-semibold bg-green text-white border-none rounded cursor-pointer whitespace-nowrap"
            >
              Zoom
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="py-1.5 px-2.5 text-[11px] font-semibold bg-white text-ink-light border border-rule rounded cursor-pointer whitespace-nowrap"
            >
              ✕
            </button>
          </div>
        </foreignObject>
      )}
    </g>
  );
}
