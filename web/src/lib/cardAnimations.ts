import gsap from 'gsap';
import { applyFaceUpToGhost } from '$lib/cardFaceUtils';

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Animate the newly played card flying into the trick zone.
 * Caller must update displayState and call tick() before calling this so the
 * trick card element already exists in the DOM.
 * fromRect: pre-captured position of the card in the hand (own card).
 * If absent, animates from the opponent's player-zone area instead.
 */
export function animatePlayedCard(
  playedCard: { suit: string; rank: string },
  playerIndex: number,
  fromRect?: DOMRect,
): void {
  const flipId = `card-${playedCard.suit}${playedCard.rank}`;
  const trickCardEl = document.querySelector(
    `[data-zone="trick"] [data-flip-id="${flipId}"]`,
  ) as HTMLElement | null;
  if (!trickCardEl) return;

  const toRect = trickCardEl.getBoundingClientRect();

  if (fromRect) {
    gsap.from(trickCardEl, {
      x: (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2),
      y: (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2),
      opacity: 0,
      duration: 0.4,
      ease: 'power2.out',
      clearProps: 'transform,opacity',
    });
  } else {
    const sourceEl = document.querySelector(`[data-player-zone="${playerIndex}"]`);
    if (!sourceEl) return;
    const srcRect = sourceEl.getBoundingClientRect();
    gsap.from(trickCardEl, {
      x: (srcRect.left + srcRect.width / 2) - (toRect.left + toRect.width / 2),
      y: (srcRect.top + srcRect.height / 2) - (toRect.top + toRect.height / 2),
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
 * Only targets [data-zone="trick"] cards.
 */
export function animateTrickToWinner(winnerEngineIndex: number): void {
  const target = document.querySelector(`[data-player-zone="${winnerEngineIndex}"]`);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const destX = rect.left + rect.width / 2;
  const destY = rect.top + rect.height / 2;

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
    // No clearProps — elements removed by Svelte; clearing would cause a blink.
  });
}

/**
 * Animate a pile card being revealed in place (stays in the pile after reveal).
 *
 * A ghost overlay performs the full flip so the real pile element is never
 * in a half-animated state. The sequence:
 *   1. Ghost (face-down) covers the pile face element.
 *   2. Ghost rotates to 90° (edge-on / invisible).
 *   3. onMidpoint() is awaited — caller updates displayState so Svelte renders
 *      the face-up card behind the hidden pile face element.
 *   4. Ghost switches to face-up appearance and rotates back to 0°.
 *   5. Ghost is removed; pile face becomes visible showing the real face-up card.
 */
export async function animatePileReveal(
  pilePlayerIndex: number,
  pileIndex: number,
  card: { suit: string; rank: string },
  onMidpoint: () => Promise<void>,
): Promise<void> {
  const pileEl = document.querySelector(
    `[data-pile-player="${pilePlayerIndex}"][data-pile-index="${pileIndex}"]`,
  ) as HTMLElement | null;

  if (!pileEl) {
    await onMidpoint();
    return;
  }

  const pRect = pileEl.getBoundingClientRect();

  const ghost = document.createElement('div');
  ghost.style.cssText = [
    'position:fixed', 'z-index:9999', 'pointer-events:none',
    'width:65px', 'height:91px', 'border-radius:7px',
    'background:#1a3464', 'border:1px solid #0f244a',
    `left:${pRect.left}px`, `top:${pRect.top}px`,
  ].join(';');
  document.body.appendChild(ghost);

  gsap.set(pileEl, { visibility: 'hidden' });

  // Phase 1: rotate ghost to edge (face-down disappears)
  await new Promise<void>((r) =>
    gsap.to(ghost, { rotationY: 90, duration: 0.2, ease: 'power2.in', onComplete: r }),
  );

  // Midpoint: caller updates displayState; Svelte renders face-up card behind the hidden pile
  await onMidpoint();

  // Switch ghost to face-up appearance (still at 90°, so invisible during swap)
  applyFaceUpToGhost(ghost, card);

  // Phase 2: rotate ghost from edge to face-up
  await new Promise<void>((r) =>
    gsap.to(ghost, { rotationY: 0, duration: 0.2, ease: 'power2.out', onComplete: r }),
  );

  ghost.remove();
  gsap.set(pileEl, { clearProps: 'visibility' });
}

/**
 * Animate a Strohmandeln pile card leaving as a ghost overlay.
 *
 * isLastCard=true  → slide only (CARDS_MOVED bottom-to-hand, no flip needed)
 * isLastCard=false → flip face-up then slide (CARD_REVEALED + CARDS_MOVED T/K cascade)
 *
 * The ghost starts at the pile face element's current position. The caller
 * is responsible for updating displayState (adding card to hand) after this
 * promise resolves.
 */
export function animateFlipReveal(
  pilePlayerIndex: number,
  pileIndex: number,
  card: { suit: string; rank: string },
  isLastCard: boolean,
): Promise<void> {
  const pileEl = document.querySelector(
    `[data-pile-player="${pilePlayerIndex}"][data-pile-index="${pileIndex}"]`,
  ) as HTMLElement | null;
  const pRect = pileEl?.getBoundingClientRect();
  if (!pRect) return Promise.resolve();

  const ghost = document.createElement('div');
  ghost.style.cssText = [
    'position:fixed', 'z-index:9999', 'pointer-events:none',
    'width:65px', 'height:91px', 'border-radius:7px',
    'background:#1a3464', 'border:1px solid #0f244a',
    `left:${pRect.left}px`, `top:${pRect.top}px`,
  ].join(';');
  document.body.appendChild(ghost);

  const handEl =
    document.querySelector(`[data-hand-area="${pilePlayerIndex}"]`) ??
    document.querySelector(`[data-player-zone="${pilePlayerIndex}"]`);

  const slideToHand = (): Promise<void> => {
    const ghostRect = ghost.getBoundingClientRect();
    const dest = handEl ? handEl.getBoundingClientRect() : pRect;
    const dx = (dest.left + dest.width / 2) - (ghostRect.left + ghostRect.width / 2);
    const dy = (dest.top + dest.height / 2) - (ghostRect.top + ghostRect.height / 2);
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
        applyFaceUpToGhost(ghost, card);
      },
    });

    tl.to(ghost, { rotationY: 0, duration: 0.2, ease: 'power2.out' });
  });
}

/**
 * Animate `count` face-down ghost cards flying from the dealer to a destination.
 * Staggered for batches; resolves after the last ghost finishes its flight.
 */
export async function animateDeal(
  dealer: number,
  to: number,
  zone: 'hand' | 'strawman',
  pile: number,
  count: number,
): Promise<void> {
  const srcEl =
    document.querySelector(`[data-hand-area="${dealer}"]`) ??
    document.querySelector(`[data-player-zone="${dealer}"]`);
  const dstEl = zone === 'hand'
    ? (document.querySelector(`[data-hand-area="${to}"]`) ??
       document.querySelector(`[data-player-zone="${to}"]`))
    : document.querySelector(`[data-pile-player="${to}"][data-pile-index="${pile}"]`);

  if (!srcEl || !dstEl) return;

  const srcRect = srcEl.getBoundingClientRect();
  const dstRect = dstEl.getBoundingClientRect();
  const dx = (dstRect.left + dstRect.width  / 2) - (srcRect.left + srcRect.width  / 2);
  const dy = (dstRect.top  + dstRect.height / 2) - (srcRect.top  + srcRect.height / 2);
  const stagger = Math.min(70, 300 / count);

  const flights = Array.from({ length: count }, (_, i) =>
    new Promise<void>((resolve) => {
      setTimeout(() => {
        const ghost = document.createElement('div');
        ghost.style.cssText = [
          'position:fixed', 'z-index:9998', 'pointer-events:none',
          'width:65px', 'height:91px', 'border-radius:7px',
          'background:#1a3464', 'border:1px solid #0f244a',
          `left:${srcRect.left + srcRect.width  / 2 - 32}px`,
          `top:${srcRect.top  + srcRect.height / 2 - 45}px`,
        ].join(';');
        document.body.appendChild(ghost);
        gsap.to(ghost, {
          x: dx, y: dy, scale: 0.85,
          duration: 0.2, ease: 'power2.out',
          onComplete: () => { ghost.remove(); resolve(); },
        });
      }, i * stagger);
    })
  );

  await Promise.all(flights);
}

/**
 * Fade-in a card that just arrived in a hand area after a CARDS_MOVED update.
 * Called after displayState is updated and tick() has been awaited.
 */
export function animateCardArrive(
  playerIndex: number,
  card: { suit: string; rank: string },
): void {
  const flipId = `card-${card.suit}${card.rank}`;
  const el = document.querySelector(
    `[data-hand-area="${playerIndex}"] [data-flip-id="${flipId}"]`,
  ) as HTMLElement | null;
  if (el) {
    gsap.from(el, { opacity: 0, scale: 0.8, duration: 0.2, clearProps: 'transform,opacity' });
  }
}
