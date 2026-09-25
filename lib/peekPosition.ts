export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PeekPlacement {
  left: number;
  top: number;
  /** Where the panel sits relative to the card. "center" means neither side
   * had room, so it overlaps the card and no pointer is drawn. */
  placement: 'below' | 'above' | 'center';
  /** Horizontal position of the pointer inside the panel. */
  arrowLeft: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** Positions a floating preview panel on its hovered card: horizontally
 * centred on the card, below it when there is room, otherwise above, and as a
 * last resort centred over it. Always kept fully inside the viewport. */
export function computePeekPlacement(
  card: Box,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 12,
  margin = 12,
): PeekPlacement {
  const cardCenterX = card.left + card.width / 2;
  const left = clamp(cardCenterX - panel.width / 2, margin, viewport.width - panel.width - margin);
  const arrowLeft = clamp(cardCenterX - left, 16, panel.width - 16);

  const spaceBelow = viewport.height - (card.top + card.height) - gap - margin;
  const spaceAbove = card.top - gap - margin;

  if (panel.height <= spaceBelow) {
    return { left, top: card.top + card.height + gap, placement: 'below', arrowLeft };
  }
  if (panel.height <= spaceAbove) {
    return { left, top: card.top - gap - panel.height, placement: 'above', arrowLeft };
  }
  const cardCenterY = card.top + card.height / 2;
  return {
    left,
    top: clamp(cardCenterY - panel.height / 2, margin, viewport.height - panel.height - margin),
    placement: 'center',
    arrowLeft,
  };
}
