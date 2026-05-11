import gsap from 'gsap';

/**
 * Pre-DOM-update snapshot of card and pile positions.
 * cards: data-flip-id → screen rect (for animating played cards)
 * piles: "${player}-${pile}" → screen rect (for animating pile reveals)
 */
export type CapturedState = {
  cards: Map<string, DOMRect>;
  piles: Map<string, DOMRect>;
};

/** Capture card and pile positions before a DOM update. */
export function captureState(): CapturedState {
  const cards = new Map<string, DOMRect>();
  document.querySelectorAll('[data-flip-id]').forEach((el) => {
    const id = el.getAttribute('data-flip-id');
    if (id) cards.set(id, (el as HTMLElement).getBoundingClientRect());
  });

  const piles = new Map<string, DOMRect>();
  document.querySelectorAll('[data-pile-player][data-pile-index]').forEach((el) => {
    const player = el.getAttribute('data-pile-player');
    const pile   = el.getAttribute('data-pile-index');
    if (player !== null && pile !== null) {
      piles.set(`${player}-${pile}`, (el as HTMLElement).getBoundingClientRect());
    }
  });

  return { cards, piles };
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Animate the newly played card flying into the trick zone.
 * Uses the pre-captured position if the card was face-up (user's own card);
 * otherwise animates from the opponent's player-token area.
 */
export function animatePlayedCard(
  captured: CapturedState,
  playedCard: { suit: string; rank: string },
  playerIndex: number,
): void {
  const flipId = `card-${playedCard.suit}${playedCard.rank}`;
  const trickCardEl = document.querySelector(
    `[data-zone="trick"] [data-flip-id="${flipId}"]`,
  ) as HTMLElement | null;
  if (!trickCardEl) return;

  const fromRect = captured.cards.get(flipId);
  const toRect   = trickCardEl.getBoundingClientRect();

  if (fromRect) {
    gsap.from(trickCardEl, {
      x: (fromRect.left + fromRect.width  / 2) - (toRect.left + toRect.width  / 2),
      y: (fromRect.top  + fromRect.height / 2) - (toRect.top  + toRect.height / 2),
      opacity: 0,
      duration: 0.4,
      ease: 'power2.out',
      clearProps: 'transform,opacity',
    });
  } else {
    const sourceEl = document.querySelector(`[data-player-token="${playerIndex}"]`);
    if (!sourceEl) return;
    const srcRect = sourceEl.getBoundingClientRect();
    gsap.from(trickCardEl, {
      x: (srcRect.left + srcRect.width  / 2) - (toRect.left + toRect.width  / 2),
      y: (srcRect.top  + srcRect.height / 2) - (toRect.top  + toRect.height / 2),
      scale: 0.7,
      opacity: 0,
      duration: 0.4,
      ease: 'power2.out',
      clearProps: 'transform,opacity',
    });
  }
}

/**
 * Animate trick-zone cards flying to the winner's seat token, then fade out.
 * Only targets [data-zone="trick"] cards — does not touch hand or pile cards.
 */
export function animateTrickToWinner(winnerEngineIndex: number): void {
  const target = document.querySelector(`[data-player-token="${winnerEngineIndex}"]`);
  if (!target) return;
  const rect  = target.getBoundingClientRect();
  const destX = rect.left + rect.width  / 2;
  const destY = rect.top  + rect.height / 2;

  const cards = document.querySelectorAll('[data-zone="trick"] [data-card-id]');
  if (!cards.length) return;

  gsap.to(cards, {
    x: (_i, el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return destX - (r.left + r.width / 2);
    },
    y: (_i, el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return destY - (r.top + r.height / 2);
    },
    scale: 0.25,
    opacity: 0,
    duration: 0.45,
    ease: 'power2.in',
    stagger: 0.04,
    // No clearProps — elements are removed by Svelte; clearing would cause a blink.
  });
}

/**
 * Animate a card becoming the new visible top of a pile (stays in place).
 * Used for CARD_REVEALED when no CARDS_MOVED follows (normal suit card, not T/K).
 */
export function animatePileTopReveal(pilePlayerIndex: number, pileIndex: number): void {
  const pileEl = document.querySelector(
    `[data-pile-player="${pilePlayerIndex}"][data-pile-index="${pileIndex}"]`,
  ) as HTMLElement | null;
  if (!pileEl) return;

  gsap.from(pileEl, {
    rotationY: 90,
    opacity: 0,
    duration: 0.35,
    ease: 'power2.out',
    clearProps: 'transform,opacity',
  });
}

/**
 * Animate a Strohmandeln pile card leaving as a ghost overlay.
 *
 * fromRect: pre-captured pile position (required when the pile element may no
 *           longer exist in the DOM after the state update).
 *
 * isLastCard=true  → slide only (CARDS_MOVED bottom-to-hand, no flip)
 * isLastCard=false → flip face-up then slide (CARD_REVEALED + CARDS_MOVED)
 *
 * When the card lands in the hand area, any pre-existing hand card element
 * matching the card is hidden at start and revealed on arrival, so the DOM
 * state doesn't leak through before the animation completes.
 */
export function animateFlipReveal(
  pilePlayerIndex: number,
  pileIndex: number,
  card: { suit: string; rank: string },
  isLastCard: boolean,
  fromRect?: DOMRect,
): Promise<void> {
  // Prefer the pre-captured position; fall back to querying the current DOM.
  const pRect = fromRect
    ?? (document.querySelector(
         `[data-pile-player="${pilePlayerIndex}"][data-pile-index="${pileIndex}"]`,
       ) as HTMLElement | null)?.getBoundingClientRect();

  if (!pRect) return Promise.resolve();

  const ghost = document.createElement('div');
  ghost.style.cssText = [
    'position:fixed',
    'z-index:9999',
    'pointer-events:none',
    'width:65px',
    'height:91px',
    'border-radius:7px',
    'background:#1a3464',
    'border:1px solid #0f244a',
    `left:${pRect.left}px`,
    `top:${pRect.top}px`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:0.85rem',
    'font-weight:800',
    'font-family:Courier New,monospace',
    'color:#1a1a2e',
  ].join(';');
  document.body.appendChild(ghost);

  // Prefer the visible hand area (user's own piles) over the player-token marker
  // (used for opponents whose hand cards aren't rendered on screen).
  const handEl =
    document.querySelector(`[data-hand-area="${pilePlayerIndex}"]`) ??
    document.querySelector(`[data-player-token="${pilePlayerIndex}"]`);

  // Hide the destination hand card (if visible) so the DOM state doesn't show
  // before the ghost animation arrives. Reveal it in slideToHand's onComplete.
  const flipId = `card-${card.suit}${card.rank}`;
  const handCardEl = document.querySelector(
    `[data-hand-area="${pilePlayerIndex}"] [data-flip-id="${flipId}"]`,
  ) as HTMLElement | null;
  if (handCardEl) gsap.set(handCardEl, { opacity: 0 });

  const slideToHand = (): Promise<void> => {
    const ghostRect = ghost.getBoundingClientRect();
    const dest = handEl ? handEl.getBoundingClientRect() : pRect;
    const dx = (dest.left + dest.width  / 2) - (ghostRect.left + ghostRect.width  / 2);
    const dy = (dest.top  + dest.height / 2) - (ghostRect.top  + ghostRect.height / 2);
    return new Promise((resolve) => {
      gsap.to(ghost, {
        x: `+=${dx}`,
        y: `+=${dy}`,
        scale: 0.5,
        opacity: 0,
        duration: 0.35,
        ease: 'power2.in',
        onComplete: () => {
          ghost.remove();
          // Reveal the hand card now that the ghost has arrived.
          if (handCardEl) gsap.to(handCardEl, { opacity: 1, duration: 0.15, clearProps: 'opacity' });
          resolve();
        },
      });
    });
  };

  if (isLastCard) {
    return slideToHand();
  }

  return new Promise((resolve) => {
    const tl = gsap.timeline({
      onComplete: () => slideToHand().then(resolve),
    });

    tl.to(ghost, {
      rotationY: 90,
      duration: 0.2,
      ease: 'power2.in',
      onComplete: () => {
        const isRed = card.suit === '♥' || card.suit === '♦';
        ghost.style.background = '#f8f5ee';
        ghost.style.border = '1px solid #bbb';
        ghost.style.color = isRed ? '#c0392b' : card.suit === 'T' ? '#6c3fbd' : '#1a1a2e';
        ghost.textContent = `${card.rank}${card.suit === 'T' ? '' : card.suit}`;
      },
    });

    tl.to(ghost, { rotationY: 0, duration: 0.2, ease: 'power2.out' });
  });
}
