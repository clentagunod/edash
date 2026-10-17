export type PaperSizeId = 'a4' | 'a3' | 'a5' | 'letter' | 'legal';
export type PaperOrientation = 'landscape' | 'portrait';
export type CardLayout = { x: number; y: number; width: number; height: number };

export const PAPER_SIZES: Record<PaperSizeId, { label: string; width: number; height: number }> = {
  a4: { label: 'A4', width: 297, height: 210 },
  a3: { label: 'A3', width: 420, height: 297 },
  a5: { label: 'A5', width: 210, height: 148 },
  letter: { label: 'Letter', width: 279.4, height: 215.9 },
  legal: { label: 'Legal', width: 355.6, height: 215.9 },
};

export const DEFAULT_SHEET_MARGIN = 4;
export const CARD_BASE_WIDTH_PX = 470;
export const CARD_BASE_HEIGHT_PX = 884;
export const CARD_BASE_WIDTH_MM = 470 * 25.4 / 96;
export const CARD_BASE_HEIGHT_MM = 884 * 25.4 / 96;

export function getPaperDimensions(paperSizeId: PaperSizeId, orientation: PaperOrientation): { width: number; height: number } {
  const { width, height } = PAPER_SIZES[paperSizeId];
  return orientation === 'landscape' ? { width, height } : { width: height, height: width };
}

export function getLearnerIndexForSheetSlot(slotIndex: number, learnerCount: number, side: 'front' | 'back'): number {
  return side === 'back' && learnerCount === 2 ? learnerCount - 1 - slotIndex : slotIndex;
}

export function getCardPreviewScale(
  layout: CardLayout,
  paperWidth: number,
  paperHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  if (paperWidth <= 0 || paperHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return { x: 0, y: 0 };
  return {
    x: layout.width / paperWidth * canvasWidth / CARD_BASE_WIDTH_PX,
    y: layout.height / paperHeight * canvasHeight / CARD_BASE_HEIGHT_PX,
  };
}

export function makeDefaultCardLayouts(
  count: number,
  paperWidth: number,
  paperHeight: number,
  side: 'front' | 'back' = 'front',
  oneCardPerSheet = false,
): CardLayout[] {
  if (!count) return [];
  if (oneCardPerSheet) {
    return [{
      x: DEFAULT_SHEET_MARGIN,
      y: DEFAULT_SHEET_MARGIN,
      width: paperWidth - DEFAULT_SHEET_MARGIN * 2,
      height: paperHeight - DEFAULT_SHEET_MARGIN * 2,
    }];
  }
  const slotCount = Math.max(count, 2);
  const slotWidth = paperWidth / slotCount;
  const width = slotWidth - DEFAULT_SHEET_MARGIN * 2;
  const height = Math.min(
    paperHeight - DEFAULT_SHEET_MARGIN * 2,
    width / (CARD_BASE_WIDTH_MM / CARD_BASE_HEIGHT_MM),
  );
  const y = (paperHeight - height) / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: count === 1 && side === 'back'
      ? slotWidth + DEFAULT_SHEET_MARGIN
      : slotWidth * index + DEFAULT_SHEET_MARGIN,
    y,
    width,
    height,
  }));
}
