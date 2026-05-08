export type SlotName = 'bottom' | 'top' | 'top-left' | 'top-right' | 'left' | 'right';

const SEAT_SLOTS: Record<number, SlotName[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'right', 'left'],
  4: ['bottom', 'right', 'top', 'left'],
  5: ['bottom', 'right', 'top-right', 'top-left', 'left'],
  6: ['bottom', 'right', 'top-right', 'top', 'top-left', 'left'],
};

export function getSlotForSeat(myEngineIdx: number, seatEngineIdx: number, total: number): SlotName {
  const slots = SEAT_SLOTS[Math.min(total, 6)] ?? SEAT_SLOTS[6];
  const offset = (seatEngineIdx - myEngineIdx + total) % total;
  return slots[offset];
}

export function isVerticalSlot(slot: SlotName): boolean {
  return slot === 'left' || slot === 'right';
}
