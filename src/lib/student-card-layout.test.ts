import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET_MARGIN,
  getCardPreviewScale,
  getLearnerIndexForSheetSlot,
  getPaperDimensions,
  makeDefaultCardLayouts,
  PAPER_SIZES,
  type PaperSizeId,
} from './student-card-layout';

describe('student card paper layouts', () => {
  it('uses the selected paper dimensions and orientation', () => {
    expect(getPaperDimensions('a4', 'landscape')).toEqual({ width: 297, height: 210 });
    expect(getPaperDimensions('letter', 'portrait')).toEqual({ width: 215.9, height: 279.4 });
  });

  it.each(Object.keys(PAPER_SIZES) as PaperSizeId[])('fits two cards within %s landscape paper', (paperSizeId) => {
    const { width: paperWidth, height: paperHeight } = getPaperDimensions(paperSizeId, 'landscape');
    const layouts = makeDefaultCardLayouts(2, paperWidth, paperHeight);
    const slotWidth = paperWidth / 2;

    expect(layouts).toHaveLength(2);
    layouts.forEach(({ x, y, width, height }, index) => {
      expect(x).toBe(index * slotWidth + DEFAULT_SHEET_MARGIN);
      expect(y).toBe(DEFAULT_SHEET_MARGIN);
      expect(x + width).toBeLessThanOrEqual((index + 1) * slotWidth - DEFAULT_SHEET_MARGIN);
      expect(y + height).toBeLessThanOrEqual(paperHeight - DEFAULT_SHEET_MARGIN);
      expect(width).toBe(slotWidth - DEFAULT_SHEET_MARGIN * 2);
      expect(height).toBe(paperHeight - DEFAULT_SHEET_MARGIN * 2);
    });
  });

  it('fits a single front in the left A5 area and its back in the right A5 area', () => {
    const { width: paperWidth, height: paperHeight } = getPaperDimensions('a4', 'landscape');
    const [front] = makeDefaultCardLayouts(1, paperWidth, paperHeight, 'front');
    const [back] = makeDefaultCardLayouts(1, paperWidth, paperHeight, 'back');
    const halfWidth = paperWidth / 2;

    expect(front.x).toBe(DEFAULT_SHEET_MARGIN);
    expect(back.x).toBe(halfWidth + DEFAULT_SHEET_MARGIN);
    expect(front.width).toBe(halfWidth - DEFAULT_SHEET_MARGIN * 2);
    expect(back.width).toBe(front.width);
    for (const layout of [front, back]) {
      expect(layout.y).toBe(DEFAULT_SHEET_MARGIN);
      expect(layout.y + layout.height).toBe(paperHeight - DEFAULT_SHEET_MARGIN);
    }
  });

  it('keeps the second learner in the right slot on both sides', () => {
    const { width: paperWidth, height: paperHeight } = getPaperDimensions('a4', 'landscape');
    const fronts = makeDefaultCardLayouts(2, paperWidth, paperHeight, 'front');
    const backs = makeDefaultCardLayouts(2, paperWidth, paperHeight, 'back');

    expect(backs.map(({ x }) => x)).toEqual(fronts.map(({ x }) => x));
    expect(backs[1].x).toBeGreaterThan(backs[0].x);
  });

  it('reverses two learners on the back sheet for duplex alignment', () => {
    expect([0, 1].map((slot) => getLearnerIndexForSheetSlot(slot, 2, 'front'))).toEqual([0, 1]);
    expect([0, 1].map((slot) => getLearnerIndexForSheetSlot(slot, 2, 'back'))).toEqual([1, 0]);
  });

  it('keeps the single learner in the right-hand back position', () => {
    expect(getLearnerIndexForSheetSlot(0, 1, 'back')).toBe(0);
  });

  it('returns no cards when no learners are selected', () => {
    expect(makeDefaultCardLayouts(0, 297, 210)).toEqual([]);
  });

  it('scales the full card to the visible canvas dimensions', () => {
    const layout = { x: 4, y: 4, width: 140.5, height: 202 };
    const scale = getCardPreviewScale(layout, 297, 210, 900, 636.36);

    expect(scale.x * 470).toBeCloseTo(layout.width / 297 * 900);
    expect(scale.y * 884).toBeCloseTo(layout.height / 210 * 636.36);
  });

  it('returns zero preview scale until the paper canvas is measured', () => {
    expect(getCardPreviewScale({ x: 0, y: 0, width: 100, height: 100 }, 297, 210, 0, 0))
      .toEqual({ x: 0, y: 0 });
  });
});
