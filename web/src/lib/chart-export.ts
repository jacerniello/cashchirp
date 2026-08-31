/**
 * Chart export utility - exports charts as PNG with watermark
 */

// Fixed logo size in pixels (consistent across all exports)
const LOGO_SIZE = 72;
const LOGO_PADDING = 14; // Padding around the logo
const FONT_SIZE = 28;
const LOGO_PATH = '/logo.svg';   // the one logo — public/logo.svg

// Title bar constants
const TITLE_HEIGHT = 60;
const TITLE_FONT_SIZE = 28;
const TITLE_COLOR = '#1f2937';

/**
 * Calculate the watermark height needed to fit the logo at minimum size
 */
function calculateWatermarkHeight(logoSize: number): number {
  return logoSize + LOGO_PADDING * 2;
}

/**
 * Load an image and return it as an HTMLImageElement
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/**
 * Export a canvas element as PNG with cashchirp.com watermark
 * @param canvas - The chart canvas to export
 * @param title - Filename prefix (will be sanitized)
 * @param legend - Optional legend items to include
 * @param displayTitle - Optional title to display at the top of the export
 */
export async function exportChartAsPng(
  canvas: HTMLCanvasElement,
  title: string = 'chart',
  legend?: ExportLegendItem[],
  displayTitle?: string
): Promise<void> {
  // Use fixed logo size for consistency
  const logoSize = LOGO_SIZE;
  const watermarkHeight = calculateWatermarkHeight(logoSize);
  const padding = LOGO_PADDING;

  // Calculate title height
  const titleHeight = displayTitle ? TITLE_HEIGHT : 0;

  // Calculate legend height
  const LEGEND_HEIGHT = 72;
  const LEGEND_FONT_SIZE = 24;
  const legendHeight = legend && legend.length > 0 ? LEGEND_HEIGHT : 0;

  // Create new canvas with space for title, chart, legend, and watermark
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = canvas.width;
  exportCanvas.height = titleHeight + canvas.height + legendHeight + watermarkHeight;

  const ctx = exportCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  // Draw title if provided
  if (displayTitle) {
    ctx.fillStyle = TITLE_COLOR;
    ctx.font = `600 ${TITLE_FONT_SIZE}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(displayTitle, exportCanvas.width / 2, titleHeight / 2);
    ctx.textAlign = 'left'; // Reset
  }

  // Copy original chart (offset by title height)
  ctx.drawImage(canvas, 0, titleHeight);

  // Draw legend if provided
  if (legend && legend.length > 0) {
    const legendY = titleHeight + canvas.height;
    ctx.fillStyle = '#f9fafb';
    ctx.fillRect(0, legendY, exportCanvas.width, legendHeight);

    ctx.font = `600 ${LEGEND_FONT_SIZE}px system-ui, -apple-system, sans-serif`;
    const SQUARE_SIZE = 20;
    const SQUARE_TEXT_GAP = 12;
    const BOX_PADDING_X = 14;
    const BOX_PADDING_Y = 12;
    const ITEM_GAP = 16;
    const BORDER_RADIUS = 10;

    const itemWidths = legend.map(item => SQUARE_SIZE + SQUARE_TEXT_GAP + ctx.measureText(item.label).width + BOX_PADDING_X * 2);
    const totalWidth = itemWidths.reduce((sum, w) => sum + w, 0) + ITEM_GAP * (legend.length - 1);

    let x = (exportCanvas.width - totalWidth) / 2;
    const y = legendY + legendHeight / 2;
    const boxHeight = LEGEND_FONT_SIZE + BOX_PADDING_Y * 2;

    legend.forEach((item, index) => {
      const boxWidth = itemWidths[index];
      const boxX = x;
      const boxY = y - boxHeight / 2;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, BORDER_RADIUS);
      ctx.fill();

      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, BORDER_RADIUS);
      ctx.stroke();

      const squareX = x + BOX_PADDING_X;
      const squareY = y - SQUARE_SIZE / 2;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.roundRect(squareX, squareY, SQUARE_SIZE, SQUARE_SIZE, 4);
      ctx.fill();

      ctx.fillStyle = '#1f2937';
      ctx.font = `600 ${LEGEND_FONT_SIZE}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, squareX + SQUARE_SIZE + SQUARE_TEXT_GAP, y);

      x += boxWidth + ITEM_GAP;
    });
  }

  // Draw watermark bar (subtle gray)
  const watermarkY = titleHeight + canvas.height + legendHeight;
  ctx.fillStyle = '#f9fafb';
  ctx.fillRect(0, watermarkY, exportCanvas.width, watermarkHeight);

  // Calculate watermark position (right-aligned, with proper padding)
  ctx.font = `${FONT_SIZE}px system-ui, -apple-system, sans-serif`;
  const textWidth = ctx.measureText('cashchirp.com').width;
  const logoTextGap = 8;
  const rightPadding = 20;
  const totalWatermarkWidth = logoSize + logoTextGap + textWidth + rightPadding;
  // Ensure watermark stays within bounds (minimum padding of 10px from left edge)
  const logoX = Math.max(10, exportCanvas.width - totalWatermarkWidth);
  const logoY = watermarkY + (watermarkHeight - logoSize) / 2;

  // Load and draw logo
  try {
    const logo = await loadImage(LOGO_PATH);
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
  } catch {
    // If logo fails to load, continue without it
    console.warn('Failed to load logo for export watermark');
  }

  // Draw text
  ctx.fillStyle = '#6b7280';
  ctx.font = `${FONT_SIZE}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('cashchirp.com', logoX + logoSize + logoTextGap, watermarkY + watermarkHeight / 2);

  // Sanitize filename
  const sanitizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'chart';

  // Trigger download
  const link = document.createElement('a');
  link.download = `${sanitizedTitle}-cashchirp.png`;
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
}

/**
 * Export a Chart.js chart instance as PNG with watermark
 * @param chartRef - React ref to a Chart.js chart component
 * @param title - Filename prefix
 * @param legend - Optional legend items to include
 * @param displayTitle - Optional title to display at the top of the export
 */
export async function exportChartJsAsPng(
  chartRef: { current: { canvas: HTMLCanvasElement } | null },
  title: string = 'chart',
  legend?: ExportLegendItem[],
  displayTitle?: string
): Promise<void> {
  const canvas = chartRef.current?.canvas;
  if (!canvas) {
    throw new Error('Chart canvas not available');
  }
  return exportChartAsPng(canvas, title, legend, displayTitle);
}

/**
 * Resolve CSS variables and computed styles for SVG export
 * SVGs use CSS variables and Tailwind classes that need to be inlined for export
 * Must be called with original SVG (in DOM) and cloned SVG to copy computed styles
 */
function inlineStyles(originalSvg: SVGSVGElement, clonedSvg: SVGSVGElement): void {
  // Get computed style of the document root to resolve CSS variables
  const rootStyle = getComputedStyle(document.documentElement);

  // Resolve CSS variable references
  const resolveCssVar = (value: string): string => {
    if (!value || !value.includes('var(')) return value;
    return value.replace(/var\(--([^)]+)\)/g, (_, varName) => {
      return rootStyle.getPropertyValue(`--${varName}`).trim() || '#000000';
    });
  };

  // Get all elements from both original and cloned SVG
  const originalElements = originalSvg.querySelectorAll('*');
  const clonedElements = clonedSvg.querySelectorAll('*');

  // Process elements in parallel (original for computed styles, cloned for setting)
  originalElements.forEach((origEl, index) => {
    const clonedEl = clonedElements[index];
    if (!(origEl instanceof SVGElement) || !(clonedEl instanceof SVGElement)) return;

    // Get computed styles from the ORIGINAL element (which is in the DOM)
    const computed = getComputedStyle(origEl);

    // Handle stroke - resolve CSS variables
    const stroke = clonedEl.getAttribute('stroke');
    if (stroke && stroke.includes('var(')) {
      clonedEl.setAttribute('stroke', resolveCssVar(stroke));
    }

    // Handle fill - resolve CSS variables
    const fill = clonedEl.getAttribute('fill');
    if (fill && fill.includes('var(')) {
      clonedEl.setAttribute('fill', resolveCssVar(fill));
    }

    // Handle text elements - copy computed fill from original (handles Tailwind classes)
    if (origEl.tagName === 'text') {
      const computedFill = computed.fill;
      if (computedFill && computedFill !== 'none') {
        clonedEl.setAttribute('fill', computedFill);
      }
      // Also copy font styles
      clonedEl.setAttribute('font-family', computed.fontFamily);
      clonedEl.setAttribute('font-size', computed.fontSize);
      clonedEl.setAttribute('font-weight', computed.fontWeight);
    }

    // Handle line elements - copy computed stroke
    if (origEl.tagName === 'line') {
      const computedStroke = computed.stroke;
      if (computedStroke && computedStroke !== 'none') {
        clonedEl.setAttribute('stroke', computedStroke);
      }
    }

    // Handle path elements - copy computed stroke and fill
    if (origEl.tagName === 'path') {
      const computedStroke = computed.stroke;
      const computedFill = computed.fill;
      if (computedStroke && computedStroke !== 'none' && !clonedEl.getAttribute('stroke')) {
        clonedEl.setAttribute('stroke', computedStroke);
      }
      if (computedFill && computedFill !== 'none' && !clonedEl.getAttribute('fill')) {
        clonedEl.setAttribute('fill', computedFill);
      }
    }
  });
}

/** Legend item for chart export */
export interface ExportLegendItem {
  label: string;
  color: string;
  value?: string;
}

/**
 * Export an SVG element as PNG with watermark
 * @param svgElement - The SVG element to export
 * @param title - Filename prefix
 * @param scale - Scale factor for the output (default 2 for retina quality)
 * @param legend - Optional legend items to include below the chart
 * @param displayTitle - Optional title to display at the top of the export
 */
export async function exportSvgAsPng(
  svgElement: SVGSVGElement,
  title: string = 'chart',
  scale: number = 2,
  legend?: ExportLegendItem[],
  displayTitle?: string
): Promise<void> {
  // Get SVG dimensions from viewBox or attributes
  const viewBox = svgElement.getAttribute('viewBox');
  let width: number;
  let height: number;

  if (viewBox) {
    const parts = viewBox.split(' ').map(Number);
    width = parts[2];
    height = parts[3];
  } else {
    width = svgElement.clientWidth || 500;
    height = svgElement.clientHeight || 300;
  }

  // Clone SVG and serialize
  const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;
  clonedSvg.setAttribute('width', String(width));
  clonedSvg.setAttribute('height', String(height));

  // Inline CSS variables and computed styles before serializing
  // Pass original SVG (in DOM) to read computed styles, and cloned SVG to write them
  inlineStyles(svgElement, clonedSvg);

  // Add white background rect as first child
  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bgRect.setAttribute('width', '100%');
  bgRect.setAttribute('height', '100%');
  bgRect.setAttribute('fill', '#ffffff');
  clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

  const svgData = new XMLSerializer().serializeToString(clonedSvg);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  // Load SVG as image
  const svgImage = await loadImage(svgUrl);
  URL.revokeObjectURL(svgUrl);

  // Create canvas with scaled dimensions
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;

  // Use fixed logo size (not scaled) for consistency across all exports
  const logoSize = LOGO_SIZE;
  const watermarkHeight = calculateWatermarkHeight(logoSize);

  // Calculate title height
  const titleHeight = displayTitle ? TITLE_HEIGHT : 0;

  // Calculate legend height if legend items provided
  const LEGEND_HEIGHT = 72;
  const LEGEND_FONT_SIZE = 24;
  const legendHeight = legend && legend.length > 0 ? LEGEND_HEIGHT : 0;

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = scaledWidth;
  exportCanvas.height = titleHeight + scaledHeight + legendHeight + watermarkHeight;

  const ctx = exportCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  // Draw title if provided
  if (displayTitle) {
    ctx.fillStyle = TITLE_COLOR;
    ctx.font = `600 ${TITLE_FONT_SIZE}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(displayTitle, exportCanvas.width / 2, titleHeight / 2);
    ctx.textAlign = 'left'; // Reset
  }

  // Draw SVG image scaled (offset by title height)
  ctx.drawImage(svgImage, 0, titleHeight, scaledWidth, scaledHeight);

  // Draw legend if provided (styled like LineControlPanel)
  if (legend && legend.length > 0) {
    const legendY = titleHeight + scaledHeight;
    ctx.fillStyle = '#f9fafb';
    ctx.fillRect(0, legendY, scaledWidth, legendHeight);

    // Measure each item width to center the legend
    ctx.font = `600 ${LEGEND_FONT_SIZE}px system-ui, -apple-system, sans-serif`;
    const SQUARE_SIZE = 20;
    const SQUARE_TEXT_GAP = 12;
    const BOX_PADDING_X = 14;
    const BOX_PADDING_Y = 12;
    const ITEM_GAP = 16;
    const BORDER_RADIUS = 10;

    const itemWidths = legend.map(item => SQUARE_SIZE + SQUARE_TEXT_GAP + ctx.measureText(item.label).width + BOX_PADDING_X * 2);
    const totalWidth = itemWidths.reduce((sum, w) => sum + w, 0) + ITEM_GAP * (legend.length - 1);

    // Start position to center the legend
    let x = (scaledWidth - totalWidth) / 2;
    const y = legendY + legendHeight / 2;
    const boxHeight = LEGEND_FONT_SIZE + BOX_PADDING_Y * 2;

    legend.forEach((item, index) => {
      const boxWidth = itemWidths[index];
      const boxX = x;
      const boxY = y - boxHeight / 2;

      // Draw rounded box background
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, BORDER_RADIUS);
      ctx.fill();

      // Draw rounded box border
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, BORDER_RADIUS);
      ctx.stroke();

      // Draw color square (rounded)
      const squareX = x + BOX_PADDING_X;
      const squareY = y - SQUARE_SIZE / 2;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.roundRect(squareX, squareY, SQUARE_SIZE, SQUARE_SIZE, 4);
      ctx.fill();

      // Draw label (semibold)
      ctx.fillStyle = '#1f2937';
      ctx.font = `600 ${LEGEND_FONT_SIZE}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, squareX + SQUARE_SIZE + SQUARE_TEXT_GAP, y);

      // Move to next item
      x += boxWidth + ITEM_GAP;
    });
  }

  // Draw watermark bar
  const watermarkY = titleHeight + scaledHeight + legendHeight;
  ctx.fillStyle = '#f9fafb';
  ctx.fillRect(0, watermarkY, scaledWidth, watermarkHeight);

  // Calculate watermark position (fixed size, right-aligned, with proper padding)
  ctx.font = `${FONT_SIZE}px system-ui, -apple-system, sans-serif`;
  const textWidth = ctx.measureText('cashchirp.com').width;
  const logoTextGap = 8;
  const rightPadding = 20;
  const totalWatermarkWidth = logoSize + logoTextGap + textWidth + rightPadding;
  // Ensure watermark stays within bounds (minimum padding of 10px from left edge)
  const logoX = Math.max(10, scaledWidth - totalWatermarkWidth);
  const logoY = watermarkY + (watermarkHeight - logoSize) / 2;

  // Load and draw logo
  try {
    const logo = await loadImage(LOGO_PATH);
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
  } catch {
    console.warn('Failed to load logo for export watermark');
  }

  // Draw text
  ctx.fillStyle = '#6b7280';
  ctx.font = `${FONT_SIZE}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('cashchirp.com', logoX + logoSize + logoTextGap, watermarkY + watermarkHeight / 2);

  // Sanitize filename
  const sanitizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'chart';

  // Trigger download
  const link = document.createElement('a');
  link.download = `${sanitizedTitle}-cashchirp.png`;
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
}
