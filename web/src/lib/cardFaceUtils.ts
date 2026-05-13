export const SUIT_SKIN: Record<string, string> = { '♥': '🏻', '♦': '🏼', '♣': '🏾', '♠': '🏿' };

export function isRedSuit(suit: string): boolean {
  return suit === '♥' || suit === '♦';
}

export function centerSymbol(rank: string, suit: string): string {
  if (suit === 'T') return rank;
  const tone = SUIT_SKIN[suit] ?? '';
  if (rank === 'K')  return `🤴${tone}`;
  if (rank === 'Q')  return `👸${tone}`;
  if (rank === 'Kn') return `🐴`;
  if (rank === 'J')  return `💂${tone}`;
  return suit;
}

export function cardColor(suit: string): string {
  if (isRedSuit(suit)) return '#c0392b';
  if (suit === 'T') return '#6c3fbd';
  return '#1a1a2e';
}

// Builds inline-styled inner HTML matching PlayingCard.svelte's face snippet.
// Used to make ghost DOM elements (in animations) look identical to the Svelte component.
export function buildCardFaceHTML(card: { rank: string; suit: string }): string {
  const suitDisplay = card.suit === 'T' ? '' : card.suit;
  const rankSpan = `<span style="font-size:1rem;font-weight:800;line-height:1">${card.rank}</span>`;
  const suitSpan = suitDisplay
    ? `<span style="font-size:1rem;font-weight:800;transform:scale(1.3);display:inline-block;line-height:1">${suitDisplay}</span>`
    : '';
  const cornerStyle = 'display:flex;flex-direction:column;align-items:center;line-height:1;gap:0';
  const topLeft = `<span style="${cornerStyle};align-self:flex-start">${rankSpan}${suitSpan}</span>`;
  const bottomRight = `<span style="${cornerStyle};align-self:flex-end;transform:rotate(180deg)">${rankSpan}${suitSpan}</span>`;

  const symbol = centerSymbol(card.rank, card.suit);
  const centerScale = card.suit !== 'T' ? 'transform:scale(2);' : '';
  const center = `<span style="text-align:center;font-size:1.25rem;line-height:1;flex:1;display:flex;align-items:center;justify-content:center;font-weight:600;${centerScale}">${symbol}</span>`;

  return topLeft + center + bottomRight;
}

// Applies full face-up card appearance to a ghost overlay element.
export function applyFaceUpToGhost(ghost: HTMLElement, card: { rank: string; suit: string }): void {
  ghost.style.background = '#f8f5ee';
  ghost.style.border = '1px solid #bbb';
  ghost.style.color = cardColor(card.suit);
  ghost.style.fontFamily = "'Courier New', Courier, monospace";
  ghost.style.display = 'flex';
  ghost.style.flexDirection = 'column';
  ghost.style.justifyContent = 'space-between';
  ghost.style.alignItems = '';
  ghost.style.padding = '4px 5px';
  ghost.innerHTML = buildCardFaceHTML(card);
}
