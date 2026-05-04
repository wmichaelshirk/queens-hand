/**
 * Contract every game engine must satisfy to work with ISMCTS.
 *
 * TState — immutable game-state snapshot (engines produce new states, never mutate).
 * TMove  — move type (must be an object; used as Map key via JSON serialisation by default).
 *
 * Engines should verify conformance at module level with a type-annotated constant:
 *   const _: ISMCTSEngine<State, Move> = { getLegalMoves, applyMove, isHandOver, determinize, getReward };
 */
export interface ISMCTSEngine<TState, TMove extends object> {
  /** All moves the current player may legally make. Empty in terminal states. */
  getLegalMoves(state: TState): TMove[];

  /**
   * Transition function: apply move, return next state (and optionally presentation events).
   * Pass simulate=true in ISMCTS rollouts to skip event object construction.
   */
  applyMove(state: TState, move: TMove, simulate?: boolean): { state: TState };

  /** True once the hand/episode is terminal and getReward returns a non-null value. */
  isHandOver(state: TState): boolean;

  /**
   * Sample a fully-observable world consistent with perspectivePlayer's information set.
   * Hidden cards are re-randomised subject to any public constraints (e.g. suit-void inference).
   */
  determinize(state: TState, playerIndex: number): TState;

  /**
   * Scalar reward for playerIndex, normalised to [0, 1].
   * Returns null while the hand is still in progress.
   */
  getReward(state: TState, playerIndex: number): number | null;
}
