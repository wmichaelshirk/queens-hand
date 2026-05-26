import { v } from "convex/values";
import {
  mutation, query, internalMutation, internalAction, internalQuery,
  MutationCtx, QueryCtx,
} from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import * as Slobberhannes from "../engines/slobberhannes";
import * as Strohmandeln from "../engines/strohmandeln";
import * as Dreiertarock from "../engines/dreiertarock";
import { chooseMove, evaluateMoves } from "../ai/ismcts";
import type { Move, Card, BareEvent, DeclaringSubAction } from "../types";

function movesEqual(a: Move, b: Move): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "PLAY_CARD" && b.type === "PLAY_CARD")
    return a.card.suit === b.card.suit && a.card.rank === b.card.rank;
  if (a.type === "MAKE_BID" && b.type === "MAKE_BID") return a.bid === b.bid;
  if (a.type === "PASS_BID") return true;
  if (a.type === "MAKE_ANNOUNCEMENT" && b.type === "MAKE_ANNOUNCEMENT")
    return a.announcement === b.announcement;
  if (a.type === "PASS_ANNOUNCEMENT") return true;
  if (a.type === "CHOOSE_CONTRACT" && b.type === "CHOOSE_CONTRACT")
    return a.contract === b.contract;
  if (a.type === "CHOOSE_TALON" && b.type === "CHOOSE_TALON")
    return a.choice === b.choice;
  if (a.type === "DISCARD_CARD" && b.type === "DISCARD_CARD")
    return a.card.suit === b.card.suit && a.card.rank === b.card.rank;
  if (a.type === "KONTRA" && b.type === "KONTRA")
    return a.target === b.target;
  return false;
}

function isLegalMove(legalMoves: Move[], move: Move): boolean {
  if (move.type === "SUBMIT_DECLARATION") {
    // Empty array = pass — legal iff PASS_ANNOUNCEMENT is legal
    if (move.actions.length === 0)
      return legalMoves.some(m => m.type === "PASS_ANNOUNCEMENT");
    // Each sub-action must be individually legal
    return move.actions.every(action =>
      legalMoves.some(m => movesEqual(m, action as Move))
    );
  }
  if (move.type === "SUBMIT_DISCARDS") {
    return (
      move.cards.length === 3 &&
      move.cards.every(card =>
        legalMoves.some(m => m.type === "DISCARD_CARD" && movesEqual(m, { type: "DISCARD_CARD", card } as Move))
      )
    );
  }
  return legalMoves.some(m => movesEqual(m, move));
}

const GAME_CONFIG = {
  slobberhannes: { min: 3, max: 6, default: 4 },
  strohmandeln:  { min: 2, max: 2, default: 2 },
  dreiertarock:  { min: 3, max: 4, default: 3 },
} as const;

const GAME_DEFAULT_SETTINGS: Record<string, Record<string, unknown>> = {
  slobberhannes: {},
  strohmandeln:  { scoring: 'Mayr' },
  dreiertarock:  { scoring: 'Mayr', deckType: '54' },
};

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolvePlayer(ctx: MutationCtx, guestUserId: string | undefined) {
  const authUserId = await getAuthUserId(ctx);
  const userId = authUserId ?? (guestUserId?.startsWith("guest_") ? guestUserId : null);
  if (!userId) throw new Error("Not authenticated");
  const player = await ctx.db
    .query("players")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!player) throw new Error("Player record not found");
  return player;
}

async function resolvePlayerForQuery(ctx: QueryCtx, guestUserId: string | undefined) {
  const authUserId = await getAuthUserId(ctx);
  const userId = authUserId ?? (guestUserId?.startsWith("guest_") ? guestUserId : null);
  if (!userId) return null;
  return ctx.db
    .query("players")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

// ── Engine adapters ───────────────────────────────────────────────────────────

type GameType = "slobberhannes" | "strohmandeln" | "dreiertarock";

type NormalizedPlayerBreakdown = {
  player: number;
  role:   string | null;  // 'declarer' | 'defender' | 'none' | null
  items:  { label: string; delta: number }[];
  total:  number;
};

interface EngineAdapter {
  start(config: { seats: number; scores: number[] | null; firstPlayer: number; settings: Record<string, unknown> }): { state: any; events: BareEvent[] };
  getLegalMoves(state: any): Move[];
  applyMove(state: any, move: Move): { state: any; events: BareEvent[] };
  getCurrentPlayer(state: any): number;
  getDealer(state: any): number;
  isHandOver(state: any): boolean;
  isGameOver(state: any): boolean;
  getGameResult(state: any): any;
  reDeal(state: any, settings: Record<string, unknown>): { state: any; events: BareEvent[] };
  chooseBotMove(state: any, playerIndex: number): Move;
  getHands(state: any): Card[][];
  getHandBreakdown(state: any): NormalizedPlayerBreakdown[] | null;
  getCurrentBid(state: any): string | null;
  getDeclarer(state: any): number | null;
  getContract(state: any): string | null;
  getAnnouncements(state: any): { name: string; player: number }[];
  getKontraItems(state: any): { target: string; multiplier: number }[];
}

const slobberAdapter: EngineAdapter = {
  start({ seats, scores, firstPlayer, settings: _settings }) {
    const state = Slobberhannes.dealState({
      scores: scores ?? null,
      dealerIndex: firstPlayer,
      playerCount: seats,
    });
    return { state, events: Slobberhannes.getDealEvents(firstPlayer, seats) };
  },
  getLegalMoves(state) {
    return Slobberhannes.getLegalMoves(state).map((card) => ({
      type: "PLAY_CARD" as const,
      card,
    }));
  },
  applyMove(state, move) {
    if (move.type !== "PLAY_CARD") throw new Error("Slobberhannes: only PLAY_CARD moves");
    return Slobberhannes.applyMove(state, move.card);
  },
  getCurrentPlayer(state) { return Slobberhannes.getCurrentPlayer(state); },
  getDealer(state) { return (state as Slobberhannes.State).dealer; },
  isHandOver(state) { return Slobberhannes.isHandOver(state); },
  isGameOver(state) { return Slobberhannes.isGameOver(state); },
  getGameResult(state) { return Slobberhannes.getGameResult(state); },
  reDeal(state, _settings) {
    const newDealerIndex = (state.dealer + 1) % state.playerCount;
    const newState = Slobberhannes.dealState({
      scores: state.scores,
      dealerIndex: newDealerIndex,
      playerCount: state.playerCount,
    });
    return { state: newState, events: Slobberhannes.getDealEvents(newDealerIndex, state.playerCount) };
  },
  chooseBotMove(state, playerIndex) {
    const card = chooseMove(Slobberhannes, state as Slobberhannes.State, playerIndex, {
      iterations: 200,
    });
    return { type: "PLAY_CARD", card };
  },
  getHands(state) { return state.hands as Card[][]; },
  getCurrentBid(_state) { return null; },
  getDeclarer(_state) { return null; },
  getContract(_state) { return null; },
  getAnnouncements(_state) { return []; },
  getKontraItems(_state) { return []; },
  getHandBreakdown(state) {
    const breakdown = Slobberhannes.getHandBreakdown(state as Slobberhannes.State);
    // Penalties are negated so delta < 0 means "bad" consistently across all engines.
    // (A player who took first trick + QoC shows total: -2, each item at delta: -1.)
    return breakdown.map(b => ({
      player: b.player,
      role:   null,
      items:  b.items.map(label => ({ label, delta: -1 })),
      total:  -b.total,
    }));
  },
};

const strahAdapter: EngineAdapter = {
  start({ scores, firstPlayer, settings }) {
    const rawState = Strohmandeln.dealState({
      scores: scores ?? null,
      dealerIndex: firstPlayer,
      scoring: (settings.scoring as Strohmandeln.ScoringSystemName | undefined) ?? "Mayr",
    });
    const dealEvts = Strohmandeln.getDealEvents(firstPlayer);
    return { state: rawState, events: dealEvts };
  },
  getLegalMoves(state) {
    return Strohmandeln.getLegalMoves(state) as Move[];
  },
  applyMove(state, move) {
    return Strohmandeln.applyMove(state, move as any);
  },
  getCurrentPlayer(state) { return Strohmandeln.getCurrentPlayer(state); },
  getDealer(state) { return (state as Strohmandeln.State).dealerIndex; },
  isHandOver(state) { return Strohmandeln.isHandOver(state); },
  isGameOver(state) { return Strohmandeln.isGameOver(state); },
  getGameResult(_state) { return null; },
  reDeal(state, settings) {
    const newDealerIndex = (state.dealerIndex + 1) % 2;
    const rawState = Strohmandeln.dealState({
      scores: state.scores,
      dealerIndex: newDealerIndex,
      scoring: (settings.scoring as Strohmandeln.ScoringSystemName | undefined) ?? state.scoring ?? "Mayr",
      handMultiplier: state.nextHandMultiplier,
    });
    const dealEvts = Strohmandeln.getDealEvents(newDealerIndex);
    return { state: rawState, events: dealEvts };
  },
  chooseBotMove(state, playerIndex) {
    return chooseMove(Strohmandeln, state as Strohmandeln.State, playerIndex, {
      iterations: 200,
      rolloutPolicy: Strohmandeln.rolloutPolicy,
    }) as Move;
  },
  getHands(state) { return state.hands as Card[][]; },
  getCurrentBid(_state) { return null; },
  getDeclarer(state) { return (state as Strohmandeln.State).declarer; },
  getContract(state) { return (state as Strohmandeln.State).declarer !== null ? 'play' : null; },
  getAnnouncements(state) { return (state as Strohmandeln.State).announcements ?? []; },
  getKontraItems(_state) { return []; },
  getHandBreakdown(state) {
    const breakdown = Strohmandeln.computeScoreBreakdown(state as Strohmandeln.State);
    if (!breakdown) return null;
    return breakdown.map(b => ({
      player: b.player,
      role:   b.role,
      items:  b.items,
      total:  b.total,
    }));
  },
};

const dreitAdapter: EngineAdapter = {
  start({ seats, scores, firstPlayer, settings }) {
    const deckType42 = (settings.deckType as '54' | '42' | undefined) ?? '54';
    const state = Dreiertarock.dealState({
      scores: scores ?? null,
      dealerIndex: firstPlayer,
      scoring: (settings.scoring as Dreiertarock.ScoringSystemName | undefined) ?? "Mayr",
      playerCount: seats as 3 | 4,
      deckType: deckType42,
    });
    return { state, events: Dreiertarock.getDealEvents(firstPlayer, seats as 3 | 4, deckType42) };
  },
  getLegalMoves(state) {
    return Dreiertarock.getLegalMoves(state) as Move[];
  },
  applyMove(state, move) {
    return Dreiertarock.applyMove(state, move as any);
  },
  getCurrentPlayer(state) { return Dreiertarock.getCurrentPlayer(state); },
  getDealer(state) { return (state as Dreiertarock.State).dealerIndex; },
  isHandOver(state) { return Dreiertarock.isHandOver(state); },
  isGameOver(state) { return Dreiertarock.isGameOver(state); },
  getGameResult(_state) { return null; },
  reDeal(state, settings) {
    const playerCount = (state as Dreiertarock.State).playerCount ?? 3;
    const newDealerIndex = ((state as Dreiertarock.State).dealerIndex + 1) % playerCount;
    const reDealDeckType = (state as Dreiertarock.State).deckType ?? '54';
    const newState = Dreiertarock.dealState({
      scores: state.scores,
      dealerIndex: newDealerIndex,
      scoring: (settings.scoring as Dreiertarock.ScoringSystemName | undefined) ?? (state as Dreiertarock.State).scoring ?? "Mayr",
      playerCount,
      deckType: reDealDeckType,
    });
    return { state: newState, events: Dreiertarock.getDealEvents(newDealerIndex, playerCount, reDealDeckType) };
  },
  chooseBotMove(state, playerIndex) {
    const s = state as Dreiertarock.State;

    if (s.phase === 'bidding') {
      const rewards = evaluateMoves(Dreiertarock, s, playerIndex, { iterations: 50, rolloutPolicy: Dreiertarock.rolloutPolicy, movePrior: Dreiertarock.movePrior, moveKey: Dreiertarock.moveKey });

      // Base option: PASS_BID if legal (non-forehand); otherwise MAKE_BID('Single') for forehand
      const passKey   = Dreiertarock.moveKey({ type: 'PASS_BID' });
      const singleKey = Dreiertarock.moveKey({ type: 'MAKE_BID', bid: 'Single' });
      const baseEntry = rewards.get(passKey) ?? rewards.get(singleKey);
      const baseReward = baseEntry?.avgReward ?? 0.5;

      // Only raise if the bid clears its per-level threshold above the base option
      let bestMove: Move | null = null;
      let bestReward = -Infinity;
      for (const [, entry] of rewards) {
        const m = entry.move as Move;
        if (m.type !== 'MAKE_BID') continue;
        const bid = (m as { type: 'MAKE_BID'; bid: string }).bid;
        if (bid === 'Single' && rewards.has(passKey)) continue;
        const threshold = bid === 'SoloValat' ? 0.15
                        : bid === 'Solo'      ? 0.08
                        : 0.05;
        if (entry.avgReward >= baseReward + threshold && entry.avgReward > bestReward) {
          bestMove = m;
          bestReward = entry.avgReward;
        }
      }

      if (bestMove) return bestMove;
      if (rewards.has(passKey)) return { type: 'PASS_BID' };
      return { type: 'MAKE_BID', bid: 'Single' } as Move;
    }

    if (s.phase === 'declaring') {
      const rewards    = evaluateMoves(Dreiertarock, s, playerIndex, { iterations: 600, rolloutPolicy: Dreiertarock.rolloutPolicy, moveKey: Dreiertarock.moveKey });
      const passKey    = Dreiertarock.moveKey({ type: 'PASS_ANNOUNCEMENT' });
      const passReward = rewards.get(passKey)?.avgReward ?? 0.5;

      // Batch profitable announcements; allow at most one kontra per turn.
      // Random rollouts overestimate success rates, so require per-move thresholds
      // above pass rather than any positive margin.
      const actions: DeclaringSubAction[] = [];
      let bestKontra: { action: DeclaringSubAction; reward: number } | null = null;
      for (const [key, entry] of rewards) {
        if (key === passKey) continue;
        if (entry.avgReward <= passReward) continue;
        const m = entry.move as Move;
        if (m.type === 'MAKE_ANNOUNCEMENT') {
          const ann = (m as { type: 'MAKE_ANNOUNCEMENT'; announcement: string }).announcement;
          const threshold = ann === 'Kakadu' ? 0.10
                          : ann === 'Uhu'    ? 0.08
                          : ann === 'Pagat'  ? 0.08
                          : 0.04; // Trull, Kings
          if (entry.avgReward >= passReward + threshold) {
            actions.push(m as DeclaringSubAction);
          }
        } else if (m.type === 'KONTRA') {
          const level = (m as { type: 'KONTRA'; level?: string }).level;
          const threshold = level === 'Subkontra' ? 0.15
                          : level === 'Rekontra'  ? 0.12
                          : 0.08; // Kontra
          if (entry.avgReward >= passReward + threshold) {
            if (!bestKontra || entry.avgReward > bestKontra.reward) {
              bestKontra = { action: m as DeclaringSubAction, reward: entry.avgReward };
            }
          }
        }
      }
      if (bestKontra) actions.push(bestKontra.action);

      return { type: 'SUBMIT_DECLARATION', actions } as Move;
    }

    // Forehand choosing between Single and Trischaken after an uncontested auction:
    // random rollouts slightly inflate Single's apparent value (declared play looks active),
    // so require a meaningful margin before committing to a declared game.
    if (s.phase === 'contract_choice') {
      const rewards      = evaluateMoves(Dreiertarock, s, playerIndex, { iterations: 1500, rolloutPolicy: Dreiertarock.rolloutPolicy, moveKey: Dreiertarock.moveKey });
      const singleKey    = Dreiertarock.moveKey({ type: 'CHOOSE_CONTRACT', contract: 'Single' });
      const trischakenKey = Dreiertarock.moveKey({ type: 'CHOOSE_CONTRACT', contract: 'Trischaken' });
      const singleReward    = rewards.get(singleKey)?.avgReward    ?? 0;
      const trischakenReward = rewards.get(trischakenKey)?.avgReward ?? 0;
      return (singleReward >= trischakenReward + 0.06
        ? { type: 'CHOOSE_CONTRACT', contract: 'Single' }
        : { type: 'CHOOSE_CONTRACT', contract: 'Trischaken' }) as Move;
    }

    // One-shot decisions (exchange, discard) get far more iterations than repeated trick plays
    const iterations = s.phase === 'exchange' ? 1500
                     : s.phase === 'discard'  ? 1000
                     : 400;
    return chooseMove(Dreiertarock, s, playerIndex, { iterations, rolloutPolicy: Dreiertarock.rolloutPolicy, movePrior: Dreiertarock.movePrior, moveKey: Dreiertarock.moveKey }) as Move;
  },
  getHands(state) { return state.hands as Card[][]; },
  getCurrentBid(state) { return (state as Dreiertarock.State).currentBid ?? null; },
  getDeclarer(state) { return (state as Dreiertarock.State).declarer; },
  getContract(state) { return (state as Dreiertarock.State).contract ?? null; },
  getAnnouncements(state) { return (state as Dreiertarock.State).announcements ?? []; },
  getKontraItems(state) {
    return ((state as Dreiertarock.State).kontraItems ?? []).map(k => ({
      target: k.target,
      multiplier: k.multiplier,
    }));
  },
  getHandBreakdown(state) {
    const breakdown = Dreiertarock.computeScoreBreakdown(state as Dreiertarock.State);
    if (!breakdown) return null;
    return breakdown.map(b => ({
      player: b.player,
      role:   b.role,
      items:  b.items,
      total:  b.total,
    }));
  },
};

function getAdapter(gameType: GameType): EngineAdapter {
  if (gameType === "slobberhannes") return slobberAdapter;
  if (gameType === "dreiertarock")  return dreitAdapter;
  return strahAdapter;
}

// ── Event → chat message ──────────────────────────────────────────────────────

function formatEvents(events: BareEvent[], seatNames: string[]): string[] {
  const name = (i: number) => seatNames[i] ?? `Player ${i + 1}`;
  const msgs: string[] = [];
  for (const ev of events) {
    switch (ev.type) {
      case "CARD_PLAYED":
        msgs.push(`${name(ev.player)} played ${ev.card.rank}${ev.card.suit}`);
        break;
      case "TRICK_RESOLVED":
        msgs.push(`${name(ev.winner)} won the trick`);
        break;
      case "HAND_SCORED": {
        const deltas = ev.deltas.map((d) => `${name(d.player)}: ${d.delta > 0 ? "+" : ""}${d.delta}`).join("  ");
        const totals = ev.runningTotals.map((t, i) => `${name(i)}: ${t}`).join("  ");
        msgs.push(`Hand: ${deltas}  |  Running: ${totals}`);
        break;
      }
      case "GAME_OVER": {
        const losers = ev.losers?.map((i) => name(i)).join(", ");
        msgs.push(losers ? `Game over! Loser(s): ${losers}` : "Game over!");
        break;
      }
      case "BID_MADE":
        msgs.push(`${name(ev.player)} bid: ${ev.bid}`);
        break;
      case "BID_PASSED":
        msgs.push(`${name(ev.player)} passed`);
        break;
      case "CARD_REVEALED":
        msgs.push(`${ev.card.rank}${ev.card.suit} revealed from ${name(ev.player)}'s pile ${ev.pile + 1}`);
        break;
      case "CONTRACT_SET":
        if (ev.contract === 'Trischaken') {
          msgs.push(`Trischaken — every player for themselves`);
        } else {
          msgs.push(`${name(ev.declarer)} declared ${ev.contract}`);
        }
        break;
      case "ANNOUNCEMENT_MADE":
        msgs.push(ev.announcement === 'pass'
          ? `${name(ev.player)} passed`
          : `${name(ev.player)} announced ${ev.announcement}`);
        break;
      case "CARDS_MOVED":
        if (ev.reason === 'talon-exchange') {
          const taken = ev.transfers.filter(t => t.to.zone === 'hand');
          if (taken.length > 0) {
            const player = (taken[0]!.to as { zone: 'hand'; player: number }).player;
            const cards = taken.map(t => `${t.card.rank}${t.card.suit}`).join(' ');
            msgs.push(`${name(player)} took ${cards}`);
          }
        } else {
          for (const t of ev.transfers) {
            if (t.from.zone === 'strawman' && t.to.zone === 'hand') {
              msgs.push(`${t.card.rank}${t.card.suit} → ${name(t.to.player)}'s hand`);
            }
          }
        }
        break;
      case "DEAL":
        msgs.push(
          ev.zone === 'hand'
            ? `${name(ev.dealer)} deals ${ev.count} card${ev.count !== 1 ? 's' : ''} to ${name(ev.to)}`
            : `${name(ev.dealer)} deals to ${name(ev.to)}'s pile ${(ev.pile ?? 0) + 1}`
        );
        break;
    }
  }
  return msgs;
}

// ── Game start helper ─────────────────────────────────────────────────────────

async function _startGame(
  ctx: MutationCtx,
  gameId: Id<"games">,
  game: { gameType: GameType; settings: Record<string, unknown>; creatorPlayerId: Id<"players"> },
) {
  // Guard against double-start (race condition from simultaneous markReady)
  const existing = await ctx.db
    .query("game_live_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .unique();
  if (existing) return;

  const allSeats = await ctx.db
    .query("game_seats")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();

  const seats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);

  const adapter = getAdapter(game.gameType);
  const { state, events } = adapter.start({
    seats: seats.length,
    scores: null as number[] | null,
    firstPlayer: Math.floor(Math.random() * seats.length),
    settings: game.settings,
  });

  await ctx.db.insert("game_live_state", { gameId, state });

  const currentPlayer = adapter.getCurrentPlayer(state);
  const startEvents = events.filter((e: BareEvent) => ANIMATION_EVENT_FILTER.has(e.type));
  const startBid = adapter.getCurrentBid(state);
  await ctx.db.insert("game_public_state", {
    gameId,
    currentTrick: state.currentTrick ?? [],
    scores: state.scores ?? [],
    currentTurn: currentPlayer,
    dealer: adapter.getDealer(state),
    trickNum: state.trickNum ?? 0,
    phase: state.phase ?? "playing",
    recentEvents: startEvents,
    announcements: [],
    kontraItems: [],
    ...(startBid != null ? { currentBid: startBid as string } : {}),
  });

  const hands = adapter.getHands(state);
  for (let i = 0; i < seats.length; i++) {
    await ctx.db.insert("player_hands", {
      gameId,
      seatIndex: seats[i]!.seatIndex,
      playerId: seats[i]!.playerId,
      hand: hands[i] ?? [],
    });
  }

  await ctx.db.patch(gameId, { status: "active", initialState: state });

  const seatNames = await Promise.all(
    seats.map(async (s) => {
      const p = await ctx.db.get(s.playerId);
      return p?.displayName ?? "Unknown";
    })
  );


  // Schedule bots if the first player to act is a bot
  if (currentPlayer >= 0) {
    const currentSeat = seats[currentPlayer];
    if (currentSeat) {
      const currentPlayerDoc = await ctx.db.get(currentSeat.playerId);
      if (currentPlayerDoc?.isBot) {
        await ctx.scheduler.runAfter(0, internal.games.applyBotMoves, { gameId });
      }
    }
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

export const listActiveTables = query({
  args: {},
  handler: async (ctx) => {
    const games = await ctx.db
      .query("games")
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "waiting"),
          q.eq(q.field("status"), "active"),
          q.eq(q.field("status"), "between_hands"),
        )
      )
      .order("desc")
      .take(20);

    return Promise.all(
      games.map(async (game) => {
        const rawSeats = await ctx.db
          .query("game_seats")
          .withIndex("by_game", (q) => q.eq("gameId", game._id))
          .collect();

        const seats = await Promise.all(
          rawSeats.map(async (seat) => {
            const player = await ctx.db.get(seat.playerId);
            return {
              seatIndex: seat.seatIndex,
              playerId: seat.playerId as string,
              displayName: player?.displayName ?? "Unknown",
              isBot: player?.isBot ?? false,
              ready: seat.ready ?? false,
            };
          })
        );

        return {
          _id: game._id as string,
          gameType: game.gameType,
          status: game.status,
          seatCount: game.seatCount,
          minSeatCount: game.minSeatCount,
          createdAt: game.startedAt,
          seats: seats.sort((a, b) => a.seatIndex - b.seatIndex),
        };
      })
    );
  },
});

export const getTable = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return null;

    const rawSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    const now = Date.now();
    const seats = await Promise.all(
      rawSeats.map(async (seat) => {
        const player = await ctx.db.get(seat.playerId);
        const presence = player
          ? await ctx.db
              .query("presence")
              .withIndex("by_user", (q) => q.eq("userId", player.userId))
              .unique()
          : null;
        const connected =
          !!presence &&
          presence.tableId === gameId &&
          now - presence.lastSeen < 90_000;
        return {
          seatIndex: seat.seatIndex,
          playerId: seat.playerId as string,
          displayName: player?.displayName ?? "Unknown",
          isBot: player?.isBot ?? false,
          ready: seat.ready ?? false,
          connected,
        };
      })
    );

    // Watchers: presence rows pointing at this table, not in a seat.
    const seatedUserIds = new Set(
      await Promise.all(rawSeats.map(async (s) => {
        const p = await ctx.db.get(s.playerId);
        return p?.userId ?? "";
      }))
    );
    const presenceRows = await ctx.db
      .query("presence")
      .withIndex("by_table", (q) => q.eq("tableId", gameId))
      .collect();
    const watchers = presenceRows
      .filter((p) => now - p.lastSeen < 90_000 && !seatedUserIds.has(p.userId))
      .map((p) => ({ userId: p.userId, displayName: p.displayName }));

    return {
      _id: game._id as string,
      gameType: game.gameType,
      status: game.status,
      seatCount: game.seatCount,
      minSeatCount: game.minSeatCount,
      creatorPlayerId: game.creatorPlayerId as string,
      settings: game.settings,
      createdAt: game.startedAt,
      seats: seats.sort((a, b) => a.seatIndex - b.seatIndex),
      watchers,
      result: (game.result ?? null) as { losers?: number[]; winners?: number[]; scores?: number[] } | null,
    };
  },
});

export const getTableMessages = query({
  args: { gameId: v.id("games"), sinceTs: v.number() },
  handler: async (ctx, { gameId, sinceTs }) => {
    return ctx.db
      .query("table_messages")
      .withIndex("by_game_ts", (q) => q.eq("gameId", gameId).gt("ts", sinceTs))
      .order("asc")
      .collect();
  },
});

export const getMyGameState = query({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return null;
    if (
      game.status !== "active" &&
      game.status !== "between_hands" &&
      game.status !== "finished"
    ) return null;

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);

    const caller = await resolvePlayerForQuery(ctx, guestUserId);

    // Build seat info with engine player index (position in sorted array)
    const seats = await Promise.all(
      sortedSeats.map(async (seat, enginePlayerIndex) => {
        const player = await ctx.db.get(seat.playerId);
        const handRow = await ctx.db
          .query("player_hands")
          .withIndex("by_game_and_player", (q) =>
            q.eq("gameId", gameId).eq("playerId", seat.playerId)
          )
          .unique();
        return {
          seatIndex: seat.seatIndex,
          playerId: seat.playerId as string,
          displayName: player?.displayName ?? "Unknown",
          isBot: player?.isBot ?? false,
          enginePlayerIndex,
          handSize: (handRow?.hand ?? []).length,
        };
      })
    );

    const mySeat = caller
      ? seats.find((s) => s.playerId === (caller._id as string))
      : null;

    // ── Finished phase: return game-over state for modal ─────────────────────────
    if (game.status === "finished") {
      return {
        publicState: {
          currentTrick: [] as any[],
          scores: (game.lastHandSummary as any)?.runningTotals ?? [],
          currentTurn: -1,
          dealer: 0,
          trickNum: 0,
          phase: "game_over",
          lastCompletedTrick: null as { plays: { playerIndex: number; card: any }[]; winner: number } | null,
          recentEvents: [] as BareEvent[],
        },
        myHand: [] as Card[],
        legalMoves: [] as Move[],
        seats,
        gameType: game.gameType,
        strawmen: null,
        talon: null as { revealed: boolean; groups: [Card[], Card[]] } | null,
        continuation: null,
        lastHandSummary: (game.lastHandSummary ?? null) as {
          deltas: { player: number; delta: number; reason: string }[];
          runningTotals: number[];
          seatNames: string[];
          breakdown: NormalizedPlayerBreakdown[] | null;
          gameTarget: number | null;
          losers: number[] | null;
        } | null,
      };
    }

    // ── Between-hands phase: return vote state only ────────────────────────────
    if (game.status === "between_hands") {
      const cd = (game.result ?? {}) as {
        scores?: number[];
        nextHandMultiplier?: number;
        nextDealerIndex?: number;
        scoring?: string;
      };
      const votes = (game.continuationVotes ?? {}) as Record<string, "continue" | "quit">;
      const myVote = mySeat ? (votes[String(mySeat.enginePlayerIndex)] ?? null) : null;
      return {
        publicState: {
          currentTrick: [] as any[],
          scores: cd.scores ?? [],
          currentTurn: -1,
          dealer: cd.nextDealerIndex ?? 0,
          trickNum: 0,
          phase: "hand_over",
          lastCompletedTrick: null as { plays: { playerIndex: number; card: any }[]; winner: number } | null,
          recentEvents: [] as BareEvent[],
        },
        myHand: [] as Card[],
        legalMoves: [] as Move[],
        seats,
        gameType: game.gameType,
        strawmen: null,
        talon: null as { revealed: boolean; groups: [Card[], Card[]] } | null,
        continuation: { votes, myVote },
        lastHandSummary: (game.lastHandSummary ?? null) as {
          deltas: { player: number; delta: number; reason: string }[];
          runningTotals: number[];
          seatNames: string[];
          breakdown: NormalizedPlayerBreakdown[] | null;
          gameTarget: number | null;
          losers: number[] | null;
        } | null,
      };
    }

    // ── Active phase ───────────────────────────────────────────────────────────

    const publicState = await ctx.db
      .query("game_public_state")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .unique();
    if (!publicState) return null;

    // Always load live state — needed for legal moves and Strohmandeln strawman data
    const liveState = await ctx.db
      .query("game_live_state")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .unique();

    const adapter = getAdapter(game.gameType as GameType);

    let myHand: Card[] = [];
    let legalMoves: Move[] = [];

    if (mySeat) {
      const handRow = await ctx.db
        .query("player_hands")
        .withIndex("by_game_and_player", (q) =>
          q.eq("gameId", gameId).eq("playerId", caller!._id)
        )
        .unique();
      myHand = (handRow?.hand ?? []) as Card[];

      if (liveState && publicState.currentTurn === mySeat.enginePlayerIndex) {
        legalMoves = adapter.getLegalMoves(liveState.state);
      }
    }

    // Strawman piles (Strohmandeln only) — indexed by enginePlayerIndex
    let strawmen: Array<Array<{ topCard: Card | null; depth: number }>> | null = null;
    if (game.gameType === "strohmandeln" && liveState) {
      const rawStrawmen: any[][] = liveState.state.strawmen ?? [];
      const isBidding = liveState.state.phase === 'bidding';
      strawmen = rawStrawmen.map((playerPiles: any[]) =>
        playerPiles.map((pile: { cards: any[] }) => {
          const cards = pile.cards ?? [];
          const topCard = !isBidding && cards.length > 0 ? (cards[cards.length - 1] as Card) : null;
          const depth = topCard !== null ? Math.max(0, cards.length - 1) : cards.length;
          return { topCard, depth };
        })
      );
    }

    // Talon (Dreiertarock only) — expose during bidding/exchange phases only
    let talon: { revealed: boolean; groups: [Card[], Card[]] } | null = null;
    if (game.gameType === "dreiertarock" && liveState) {
      const phase = liveState.state.phase as string;
      if (phase === "bidding" || phase === "contract_choice") {
        // Talon dealt but unrevealed — send empty groups (UI shows face-down backs)
        talon = { revealed: false, groups: [[], []] };
      } else if (phase === "exchange") {
        // Both groups are publicly revealed so declarer can choose
        talon = { revealed: true, groups: liveState.state.talonGroups as [Card[], Card[]] };
      } else if (phase === "discard") {
        // Rejected half stays on the board while the declarer discards
        const declarer = liveState.state.declarer as number;
        const activePlayers = liveState.state.activePlayers as number[];
        const firstDefender = activePlayers.find((p: number) => p !== declarer)!;
        const defCapKeys = new Set(
          ((liveState.state.capturedCards as Card[][])[firstDefender] ?? [])
            .map((c: Card) => c.suit + c.rank)
        );
        const talonGroups = liveState.state.talonGroups as [Card[], Card[]];
        const rejectedIdx = talonGroups.findIndex(g => g.every(c => defCapKeys.has(c.suit + c.rank)));
        if (rejectedIdx !== -1) {
          const rejected = talonGroups[rejectedIdx]!;
          const groups: [Card[], Card[]] = rejectedIdx === 0 ? [rejected, []] : [[], rejected];
          talon = { revealed: true, groups };
        }
      }
    }

    const liveCurrentBid = liveState ? adapter.getCurrentBid(liveState.state) : null;
    const liveDeclarer = liveState ? adapter.getDeclarer(liveState.state) : null;
    const liveContract = liveState ? adapter.getContract(liveState.state) : null;
    const liveAnnouncements = liveState ? adapter.getAnnouncements(liveState.state) : [];
    const liveKontraItems = liveState ? adapter.getKontraItems(liveState.state) : [];

    return {
      publicState: {
        currentTrick: publicState.currentTrick,
        scores: publicState.scores,
        currentTurn: publicState.currentTurn,
        dealer: publicState.dealer ?? 0,
        trickNum: publicState.trickNum,
        phase: publicState.phase,
        lastCompletedTrick: (publicState.lastCompletedTrick ?? null) as { plays: { playerIndex: number; card: any }[]; winner: number } | null,
        recentEvents: (publicState.recentEvents ?? []) as BareEvent[],
        currentBid: liveCurrentBid,
        ...(liveDeclarer !== null ? { declarer: liveDeclarer } : {}),
        contract: liveContract,
        announcements: liveAnnouncements,
        kontraItems: liveKontraItems,
      },
      myHand,
      legalMoves,
      seats,
      gameType: game.gameType,
      strawmen,
      talon,
      continuation: null,
      lastHandSummary: (game.lastHandSummary ?? null) as {
        deltas: { player: number; delta: number; reason: string }[];
        runningTotals: number[];
        seatNames: string[];
        breakdown: NormalizedPlayerBreakdown[] | null;
        gameTarget: number | null;
        losers: number[] | null;
      } | null,
    };
  },
});

export const getGameCatalog = query({
  args: {},
  handler: async () => [
    {
      type: "slobberhannes" as const,
      name: Slobberhannes.GAME_NAME,
      icon: Slobberhannes.GAME_ICON,
      options: [] as { type: "select"; key: string; label: string; default: string; choices: { value: string; label: string }[] }[],
    },
    {
      type: "strohmandeln" as const,
      name: Strohmandeln.GAME_NAME,
      icon: Strohmandeln.GAME_ICON,
      options: [
        {
          type: "select" as const,
          key: "scoring",
          label: "Scoring system",
          default: "Mayr",
          choices: (Object.keys(Strohmandeln.SCORING_SYSTEMS) as Strohmandeln.ScoringSystemName[]).map((k) => ({
            value: k,
            label: Strohmandeln.SCORING_SYSTEMS[k].name,
          })),
        },
      ],
    },
    {
      type: "dreiertarock" as const,
      name: Dreiertarock.GAME_NAME,
      icon: Dreiertarock.GAME_ICON,
      options: [
        {
          type: "select" as const,
          key: "scoring",
          label: "Scoring system",
          default: "Mayr",
          choices: (Object.keys(Dreiertarock.SCORING_SYSTEMS) as Dreiertarock.ScoringSystemName[]).map((k) => ({
            value: k,
            label: Dreiertarock.SCORING_SYSTEMS[k].name,
          })),
        },
        {
          type: "select" as const,
          key: "deckType",
          label: "Deck",
          default: "54",
          choices: [
            { value: "54", label: "54-card (standard)" },
            { value: "42", label: "42-card" },
          ],
        },
      ],
    },
  ],
});

// ── Mutations ─────────────────────────────────────────────────────────────────

export const createTable = mutation({
  args: {
    gameType: v.union(v.literal("slobberhannes"), v.literal("strohmandeln"), v.literal("dreiertarock")),
    settings: v.optional(v.record(v.string(), v.string())),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameType, settings, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const cfg = GAME_CONFIG[gameType];
    const merged = { ...(GAME_DEFAULT_SETTINGS[gameType] ?? {}), ...(settings ?? {}) };

    const gameId = await ctx.db.insert("games", {
      gameType,
      status: "waiting",
      seatCount: cfg.max,
      minSeatCount: cfg.min,
      creatorPlayerId: player._id,
      settings: merged,
      startedAt: Date.now(),
    });

    return gameId;
  },
});

export const sitDown = mutation({
  args: {
    gameId: v.id("games"),
    seatIndex: v.number(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, seatIndex, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "waiting") throw new Error("Table is not open");

    const currentSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    if (currentSeats.some((s) => s.playerId === player._id)) return; // already seated
    if (currentSeats.length >= game.seatCount) throw new Error("Table is full");
    if (seatIndex < 0 || seatIndex >= game.seatCount) throw new Error("Invalid seat");
    if (currentSeats.some((s) => s.seatIndex === seatIndex)) throw new Error("Seat is taken");

    await ctx.db.insert("game_seats", {
      gameId,
      seatIndex,
      playerId: player._id,
      ready: false,
    });
  },
});

export const addBot = mutation({
  args: {
    gameId: v.id("games"),
    seatIndex: v.number(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, seatIndex, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "waiting") throw new Error("Table is not open");
    if (game.creatorPlayerId !== player._id) throw new Error("Only the creator can add bots");

    const currentSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    if (currentSeats.length >= game.seatCount) throw new Error("Table is full");
    if (seatIndex < 0 || seatIndex >= game.seatCount) throw new Error("Invalid seat");
    if (currentSeats.some((s) => s.seatIndex === seatIndex)) throw new Error("Seat is taken");

    // Create a fresh bot player for this seat
    const botId = await ctx.db.insert("players", {
      userId: `bot_${crypto.randomUUID()}`,
      displayName: "Bot",
      isBot: true,
      ratings: {},
      createdAt: Date.now(),
    });

    await ctx.db.insert("game_seats", {
      gameId,
      seatIndex,
      playerId: botId,
      ready: true, // bots never block start
    });
  },
});

export const standUp = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game) return;
    if (game.status === "active") throw new Error("Cannot leave a seat during an active game");

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    const mySeat = allSeats.find((s) => s.playerId === player._id);
    if (!mySeat) return;

    await ctx.db.delete(mySeat._id);

    const remainingSeats = allSeats.filter((s) => s._id !== mySeat._id);
    if (remainingSeats.length > 0 && game.creatorPlayerId === player._id) {
      const next = remainingSeats
        .filter((s) => {
          // Only transfer to human players
          return true;
        })
        .sort((a, b) => a.seatIndex - b.seatIndex)[0]!;
      await ctx.db.patch(gameId, { creatorPlayerId: next.playerId });
    }
  },
});

// Called when a non-seated watcher navigates back to the lobby.
export const leaveTable = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game) return;

    // Stand up if seated (safety; normally caller is already not seated)
    if (game.status !== "active") {
      const mySeat = await ctx.db
        .query("game_seats")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .filter((q) => q.eq(q.field("playerId"), player._id))
        .unique();
      if (mySeat) await ctx.db.delete(mySeat._id);
    }

    const remainingSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    if (remainingSeats.length === 0) {
      const messages = await ctx.db
        .query("table_messages")
        .withIndex("by_game_ts", (q) => q.eq("gameId", gameId))
        .collect();
      for (const msg of messages) await ctx.db.delete(msg._id);
      await ctx.db.delete(gameId);
    }
  },
});

export const markReady = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "waiting") throw new Error("Table is not in waiting state");

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    const mySeat = allSeats.find((s) => s.playerId === player._id);
    if (!mySeat) throw new Error("You are not seated at this table");

    await ctx.db.patch(mySeat._id, { ready: true });

    const updatedSeats = allSeats.map((s) =>
      s._id === mySeat._id ? { ...s, ready: true } : s
    );
    const allReady = updatedSeats.every((s) => s.ready === true);
    if (allReady && updatedSeats.length >= game.minSeatCount) {
      await _startGame(ctx, gameId, {
        gameType: game.gameType as GameType,
        settings: game.settings as Record<string, unknown>,
        creatorPlayerId: game.creatorPlayerId,
      });
    }
  },
});

export const unready = mutation({
  args: {
    gameId: v.id("games"),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "waiting") throw new Error("Table is not in waiting state");

    const mySeat = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .filter((q) => q.eq(q.field("playerId"), player._id))
      .unique();

    if (mySeat) await ctx.db.patch(mySeat._id, { ready: false });
  },
});

export const updateSettings = mutation({
  args: {
    gameId: v.id("games"),
    settings: v.any(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, settings, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game) throw new Error("Table not found");
    if (game.status !== "waiting") throw new Error("Cannot change settings during an active game");
    if (game.creatorPlayerId !== player._id) throw new Error("Only the creator can change settings");

    await ctx.db.patch(gameId, { settings });
  },
});

function mentionsJudy(text: string): boolean {
  return /@judy\b/i.test(text);
}

export const sendTableMessage = mutation({
  args: {
    gameId: v.id("games"),
    text: v.string(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, text, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const trimmed = text.trim().slice(0, 500);

    await ctx.db.insert("table_messages", {
      gameId,
      playerId: player._id,
      displayName: player.displayName,
      text: trimmed,
      ts: Date.now(),
    });

    if (mentionsJudy(trimmed)) {
      await ctx.scheduler.runAfter(0, internal.games.askAiAdvisor, {
        gameId,
        askingPlayerId: player._id,
        question: trimmed,
      });
    }
  },
});

export const applyMove = mutation({
  args: {
    gameId: v.id("games"),
    move: v.any(),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, move, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "active") throw new Error("Game is not active");

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();

    const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);
    const myEngineIndex = sortedSeats.findIndex((s) => s.playerId === player._id);
    if (myEngineIndex === -1) throw new Error("You are not seated at this game");

    const { nextIsBot, trickJustResolved } = await _applyMoveLogic(ctx, gameId, myEngineIndex, move as Move);

    if (nextIsBot) {
      await ctx.scheduler.runAfter(0, internal.games.applyBotMoves, { gameId });
    }
  },
});

// ── Internal ──────────────────────────────────────────────────────────────────

export const startGameInternal = internalMutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return;
    await _startGame(ctx, gameId, {
      gameType: game.gameType as GameType,
      settings: game.settings as Record<string, unknown>,
      creatorPlayerId: game.creatorPlayerId,
    });
  },
});

export const applyMoveInternal = internalMutation({
  args: {
    gameId: v.id("games"),
    enginePlayerIndex: v.number(),
    move: v.any(),
  },
  handler: async (ctx, { gameId, enginePlayerIndex, move }) => {
    return _applyMoveLogic(ctx, gameId, enginePlayerIndex, move as Move);
  },
});

async function _applyMoveLogic(
  ctx: MutationCtx,
  gameId: Id<"games">,
  enginePlayerIndex: number,
  move: Move,
): Promise<{ nextIsBot: boolean; trickJustResolved: boolean }> {
  const game = await ctx.db.get(gameId);
  if (!game || game.status !== "active") return { nextIsBot: false, trickJustResolved: false };

  const liveStateRow = await ctx.db
    .query("game_live_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .unique();
  if (!liveStateRow) return { nextIsBot: false, trickJustResolved: false };

  const allSeats = await ctx.db
    .query("game_seats")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);

  const adapter = getAdapter(game.gameType as GameType);
  const state = liveStateRow.state;

  // Validate it is this player's turn
  const currentEnginePlayer = adapter.getCurrentPlayer(state);
  if (currentEnginePlayer !== enginePlayerIndex) {
    throw new Error(`Not your turn (expected player ${currentEnginePlayer}, got ${enginePlayerIndex})`);
  }

  // Validate the move is legal
  const legalMoves = adapter.getLegalMoves(state);
  if (!isLegalMove(legalMoves, move as Move)) throw new Error("Illegal move: " + JSON.stringify(move));

  const seatNames = await Promise.all(
    sortedSeats.map(async (s) => {
      const p = await ctx.db.get(s.playerId);
      return p?.displayName ?? "Unknown";
    })
  );

  // Apply the move
  const { state: nextState, events } = adapter.applyMove(state, move);

  // Capture the completed trick before state is written (engine clears currentTrick immediately)
  const trickResolvedEvent = events.find(e => e.type === "TRICK_RESOLVED") as
    | { type: "TRICK_RESOLVED"; winner: number }
    | undefined;
  let lastTrickPatch: { plays: { playerIndex: number; card: any }[]; winner: number } | undefined;
  if (trickResolvedEvent && (move as any).type === "PLAY_CARD") {
    lastTrickPatch = {
      plays: [
        ...(state.currentTrick as { playerIndex: number; card: any }[]),
        { playerIndex: adapter.getCurrentPlayer(state), card: (move as any).card },
      ],
      winner: trickResolvedEvent.winner,
    };
  }


  // Persist last hand summary so the UI can display it prominently
  const handScoredEvent = events.find((e) => e.type === "HAND_SCORED") as
    | { type: "HAND_SCORED"; deltas: { player: number; delta: number; reason: string }[]; runningTotals: number[] }
    | undefined;
  const gameOverEvent = events.find((e) => e.type === "GAME_OVER") as
    | { type: "GAME_OVER"; finalScores: number[]; losers?: number[] }
    | undefined;
  if (handScoredEvent) {
    await ctx.db.patch(gameId, {
      lastHandSummary: {
        deltas: handScoredEvent.deltas,
        runningTotals: handScoredEvent.runningTotals,
        seatNames,
        breakdown: adapter.getHandBreakdown(nextState),
        gameTarget: (nextState as any).loseAt ?? null,
        losers: gameOverEvent?.losers ?? null,
      },
    });
  }

  // Append to game_moves
  const existingMoves = await ctx.db
    .query("game_moves")
    .withIndex("by_game_seq", (q) => q.eq("gameId", gameId))
    .order("desc")
    .first();
  const seq = (existingMoves?.seq ?? -1) + 1;
  await ctx.db.insert("game_moves", {
    gameId,
    seq,
    seatIndex: sortedSeats[enginePlayerIndex]!.seatIndex,
    move,
    ts: Date.now(),
  });

  // Handle terminal states
  if (adapter.isGameOver(nextState)) {
    await _finalizeGame(ctx, gameId, game.creatorPlayerId, nextState, adapter, sortedSeats);
    return { nextIsBot: false, trickJustResolved: false };
  }

  if (adapter.isHandOver(nextState)) {
    await _enterBetweenHands(ctx, gameId, game, nextState, sortedSeats, seatNames);
    return { nextIsBot: false, trickJustResolved: false };
  }

  // Normal move: update live state and public state
  await ctx.db.patch(liveStateRow._id, { state: nextState });
  await _updatePublicAndHands(ctx, gameId, nextState, sortedSeats, adapter, lastTrickPatch, events);

  const nextPlayer = adapter.getCurrentPlayer(nextState);
  const nextIsBot = await _isBot(ctx, sortedSeats, nextPlayer);
  return { nextIsBot, trickJustResolved: lastTrickPatch !== undefined };
}

const ANIMATION_EVENT_FILTER = new Set([
  "CARD_PLAYED", "TRICK_RESOLVED", "CARD_REVEALED", "CARDS_MOVED",
  "BID_MADE", "BID_PASSED", "HAND_SCORED", "DEAL",
  "CONTRACT_SET", "ANNOUNCEMENT_MADE",
]);

async function _updatePublicAndHands(
  ctx: MutationCtx,
  gameId: Id<"games">,
  state: any,
  sortedSeats: Doc<"game_seats">[],
  adapter: EngineAdapter,
  lastTrickPatch?: { plays: { playerIndex: number; card: any }[]; winner: number },
  recentEvents?: BareEvent[],
) {
  const publicRow = await ctx.db
    .query("game_public_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .unique();

  const filteredEvents = (recentEvents ?? []).filter(e => ANIMATION_EVENT_FILTER.has(e.type));
  const patchBid = adapter.getCurrentBid(state);
  const patchDeclarer = adapter.getDeclarer(state);
  const patchContract = adapter.getContract(state);

  if (publicRow) {
    await ctx.db.patch(publicRow._id, {
      currentTrick: state.currentTrick ?? [],
      scores: state.scores ?? [],
      currentTurn: adapter.getCurrentPlayer(state),
      dealer: adapter.getDealer(state),
      trickNum: state.trickNum ?? 0,
      phase: state.phase ?? "playing",
      ...(lastTrickPatch !== undefined ? { lastCompletedTrick: lastTrickPatch } : {}),
      recentEvents: filteredEvents,
      ...(patchBid != null ? { currentBid: patchBid as string } : {}),
      ...(patchDeclarer !== null ? { declarer: patchDeclarer as number } : {}),
      ...(patchContract != null ? { contract: patchContract } : {}),
      announcements: adapter.getAnnouncements(state),
      kontraItems: adapter.getKontraItems(state),
    });
  }

  const hands = adapter.getHands(state);
  for (let i = 0; i < sortedSeats.length; i++) {
    const seat = sortedSeats[i]!;
    const handRow = await ctx.db
      .query("player_hands")
      .withIndex("by_game_and_player", (q) =>
        q.eq("gameId", gameId).eq("playerId", seat.playerId)
      )
      .unique();
    if (handRow) {
      await ctx.db.patch(handRow._id, { hand: hands[i] ?? [] });
    }
  }
}

async function _isBot(ctx: MutationCtx, sortedSeats: Doc<"game_seats">[], enginePlayerIndex: number): Promise<boolean> {
  if (enginePlayerIndex < 0 || enginePlayerIndex >= sortedSeats.length) return false;
  const seat = sortedSeats[enginePlayerIndex]!;
  const player = await ctx.db.get(seat.playerId);
  return player?.isBot ?? false;
}

async function _finalizeGame(
  ctx: MutationCtx,
  gameId: Id<"games">,
  creatorPlayerId: Id<"players">,
  state: any,
  adapter: EngineAdapter,
  sortedSeats: Doc<"game_seats">[],
) {
  const result = adapter.getGameResult(state);
  await ctx.db.patch(gameId, {
    status: "finished",
    endedAt: Date.now(),
    result,
  });

  // Clean up live collections
  const liveRows = await ctx.db
    .query("game_live_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of liveRows) await ctx.db.delete(row._id);

  const publicRows = await ctx.db
    .query("game_public_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of publicRows) await ctx.db.delete(row._id);

  const handRows = await ctx.db
    .query("player_hands")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of handRows) await ctx.db.delete(row._id);

  // Final message
  let resultText = "Game finished.";
  if (result?.losers?.length) {
    const seatNames = await Promise.all(
      sortedSeats.map(async (s) => {
        const p = await ctx.db.get(s.playerId);
        return p?.displayName ?? "Unknown";
      })
    );
    const loserNames = result.losers.map((i: number) => seatNames[i]).join(", ");
    resultText = `Game over! Loser(s): ${loserNames}`;
  }
  await ctx.db.insert("table_messages", {
    gameId,
    playerId: creatorPlayerId,
    displayName: "Game",
    text: resultText,
    ts: Date.now(),
  });
}

// ── Strohmandeln between-hands helpers ────────────────────────────────────────

async function _enterBetweenHands(
  ctx: MutationCtx,
  gameId: Id<"games">,
  game: Doc<"games">,
  handOverState: any,
  sortedSeats: Doc<"game_seats">[],
  seatNames: string[],
) {
  // Store continuation info so the next hand can be re-dealt without the live state
  const playerCount: number = handOverState.playerCount ?? sortedSeats.length;
  const currentDealerIndex = getAdapter(game.gameType as GameType).getDealer(handOverState);
  const continuationData = {
    scores: [...(handOverState.scores ?? [])],
    nextHandMultiplier: handOverState.nextHandMultiplier ?? 1,
    nextDealerIndex: (currentDealerIndex + 1) % playerCount,
    playerCount,
    ...(handOverState.scoring !== undefined ? { scoring: handOverState.scoring as string } : {}),
    ...(handOverState.deckType !== undefined ? { deckType: handOverState.deckType as '54' | '42' } : {}),
    ...(handOverState.loseAt !== undefined ? { loseAt: handOverState.loseAt as number } : {}),
  };

  // Delete all live rows — they are no longer needed
  const liveRows = await ctx.db
    .query("game_live_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of liveRows) await ctx.db.delete(row._id);

  const handRows = await ctx.db
    .query("player_hands")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of handRows) await ctx.db.delete(row._id);

  const publicRows = await ctx.db
    .query("game_public_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of publicRows) await ctx.db.delete(row._id);

  // Bots always vote "continue" immediately
  const votes: Record<string, "continue" | "quit"> = {};
  for (let i = 0; i < sortedSeats.length; i++) {
    const player = await ctx.db.get(sortedSeats[i]!.playerId);
    if (player?.isBot) votes[String(i)] = "continue";
  }

  await ctx.db.patch(gameId, {
    status: "between_hands",
    result: continuationData,
    continuationVotes: votes,
  });


  // If all seats are bots (edge case), start the next hand immediately
  if (Object.keys(votes).length === sortedSeats.length) {
    await _startNextHand(ctx, gameId, game, sortedSeats);
  }
}

async function _startNextHand(
  ctx: MutationCtx,
  gameId: Id<"games">,
  game: Doc<"games">,
  sortedSeats: Doc<"game_seats">[],
) {
  const currentSeats = await ctx.db
    .query("game_seats")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  if (currentSeats.length < game.minSeatCount) {
    await _quitGame(ctx, gameId, game.creatorPlayerId);
    return;
  }

  const cd = (game.result ?? {}) as {
    scores: number[];
    nextHandMultiplier: number;
    nextDealerIndex: number;
    scoring?: string;
    playerCount?: number;
    deckType?: '54' | '42';
    loseAt?: number;
  };

  let newState: any;
  let dealEvents: BareEvent[];

  if (game.gameType === "dreiertarock") {
    newState = Dreiertarock.dealState({
      scores: cd.scores,
      dealerIndex: cd.nextDealerIndex,
      scoring: (cd.scoring ?? "Mayr") as Dreiertarock.ScoringSystemName,
      playerCount: (cd.playerCount ?? 3) as 3 | 4,
      deckType: cd.deckType ?? '54',
    });
    dealEvents = Dreiertarock.getDealEvents(cd.nextDealerIndex, (cd.playerCount ?? 3) as 3 | 4, cd.deckType ?? '54');
  } else if (game.gameType === "slobberhannes") {
    newState = Slobberhannes.dealState({
      scores: cd.scores,
      dealerIndex: cd.nextDealerIndex,
      playerCount: cd.playerCount ?? 4,
      ...(cd.loseAt !== undefined ? { loseAt: cd.loseAt } : {}),
    });
    dealEvents = Slobberhannes.getDealEvents(cd.nextDealerIndex, cd.playerCount ?? 4);
  } else {
    newState = Strohmandeln.dealState({
      scores: cd.scores,
      dealerIndex: cd.nextDealerIndex,
      scoring: (cd.scoring ?? "Mayr") as Strohmandeln.ScoringSystemName,
      handMultiplier: cd.nextHandMultiplier ?? 1,
    });
    dealEvents = Strohmandeln.getDealEvents(cd.nextDealerIndex);
  }

  await ctx.db.insert("game_live_state", { gameId, state: newState });

  const nextAdapter = getAdapter(game.gameType as GameType);
  const currentPlayer = nextAdapter.getCurrentPlayer(newState);
  const handStartEvents = dealEvents.filter((e) => ANIMATION_EVENT_FILTER.has(e.type));
  const nextBid = nextAdapter.getCurrentBid(newState);
  await ctx.db.insert("game_public_state", {
    gameId,
    currentTrick: newState.currentTrick ?? [],
    scores: newState.scores ?? [],
    currentTurn: currentPlayer,
    dealer: nextAdapter.getDealer(newState),
    trickNum: newState.trickNum ?? 0,
    phase: newState.phase ?? "bidding",
    recentEvents: handStartEvents,
    announcements: [],
    kontraItems: [],
    ...(nextBid != null ? { currentBid: nextBid as string } : {}),
  });

  const hands = newState.hands as Card[][];
  await Promise.all(sortedSeats.map((seat, i) =>
    ctx.db.insert("player_hands", {
      gameId,
      seatIndex: seat.seatIndex,
      playerId: seat.playerId,
      hand: hands[i] ?? [],
    })
  ));

  await ctx.db.patch(gameId, {
    status: "active",
    continuationVotes: undefined,
  });

  if (currentPlayer >= 0) {
    const currentSeat = sortedSeats[currentPlayer];
    if (currentSeat) {
      const currentPlayerDoc = await ctx.db.get(currentSeat.playerId);
      if (currentPlayerDoc?.isBot) {
        await ctx.scheduler.runAfter(0, internal.games.applyBotMoves, { gameId });
      }
    }
  }
}

async function _quitGame(
  ctx: MutationCtx,
  gameId: Id<"games">,
  creatorPlayerId: Id<"players">,
) {
  await ctx.db.patch(gameId, {
    status: "finished",
    endedAt: Date.now(),
    continuationVotes: undefined,
  });

  // Clean up any remaining live rows (should already be gone, but be safe)
  const liveRows = await ctx.db
    .query("game_live_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of liveRows) await ctx.db.delete(row._id);

  const publicRows = await ctx.db
    .query("game_public_state")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of publicRows) await ctx.db.delete(row._id);

  const handRows = await ctx.db
    .query("player_hands")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  for (const row of handRows) await ctx.db.delete(row._id);

  await ctx.db.insert("table_messages", {
    gameId,
    playerId: creatorPlayerId,
    displayName: "Game",
    text: "Session ended. Thanks for playing!",
    ts: Date.now(),
  });
}

export const voteContinue = mutation({
  args: {
    gameId: v.id("games"),
    vote: v.union(v.literal("continue"), v.literal("quit")),
    guestUserId: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, vote, guestUserId }) => {
    const player = await resolvePlayer(ctx, guestUserId);
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "between_hands") throw new Error("Not in between-hands phase");

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);
    const myEngineIndex = sortedSeats.findIndex((s) => s.playerId === player._id);
    if (myEngineIndex === -1) throw new Error("You are not seated at this table");

    const votes: Record<string, "continue" | "quit"> = {
      ...((game.continuationVotes ?? {}) as Record<string, "continue" | "quit">),
      [String(myEngineIndex)]: vote,
    };
    await ctx.db.patch(gameId, { continuationVotes: votes });

    // Any quit vote immediately ends the session
    if (Object.values(votes).some((v) => v === "quit")) {
      await _quitGame(ctx, gameId, game.creatorPlayerId);
      return;
    }

    // All players voted continue → start the next hand
    if (Object.keys(votes).length === sortedSeats.length) {
      await _startNextHand(ctx, gameId, game, sortedSeats);
    }
  },
});

export const getBotMoveInfo = internalQuery({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "active") return null;

    const liveStateRow = await ctx.db
      .query("game_live_state")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .unique();
    if (!liveStateRow) return null;

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);

    const adapter = getAdapter(game.gameType as GameType);
    const state = liveStateRow.state;
    const currentEnginePlayer = adapter.getCurrentPlayer(state);

    if (currentEnginePlayer < 0 || currentEnginePlayer >= sortedSeats.length) return null;

    const currentSeat = sortedSeats[currentEnginePlayer]!;
    const currentPlayerDoc = await ctx.db.get(currentSeat.playerId);

    return {
      state,
      enginePlayerIndex: currentEnginePlayer,
      isBot: currentPlayerDoc?.isBot ?? false,
      phase: state.phase,
      gameType: game.gameType,
    };
  },
});

export const applyBotMoves = internalAction({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    for (let i = 0; i < 60; i++) {
      const info = await ctx.runQuery(internal.games.getBotMoveInfo, { gameId });
      if (!info || !info.isBot || info.phase === "game_over") break;

      const adapter = getAdapter(info.gameType as GameType);
      const move = adapter.chooseBotMove(info.state, info.enginePlayerIndex);

      const result = await ctx.runMutation(internal.games.applyMoveInternal, {
        gameId,
        enginePlayerIndex: info.enginePlayerIndex,
        move,
      });

      if (!result.nextIsBot) break;
      if (result.trickJustResolved) {
        await new Promise<void>(r => setTimeout(r, 1200));
      } else if (info.phase === 'declaring' || info.phase === 'bidding') {
        await new Promise<void>(r => setTimeout(r, 600));
      }
    }
  },
});

// ── AI Advisor ("Judy") ───────────────────────────────────────────────────────

const GAME_RULES: Record<string, string> = {
  slobberhannes:
`Slobberhannes is a trick-avoidance game (3–6 players, no trumps).
Rules: You must follow the led suit if able; otherwise play any card. Highest card of the led suit wins the trick.
Penalties (each costs +1 point): winning the first trick, winning the last trick, winning any trick containing Q♣.
Taking all three penalties in one hand costs +4 instead of +3 (sweep penalty).
The player with the highest cumulative score when any player reaches the target (default 10) loses.`,

  strohmandeln:
`Strohmandeln is a 2-player trick-taking game using a 54-card Tarock deck.
Tarocks (I–XXI plus Sküs ★) are permanent trumps. Key tarocks: Pagat (I, lowest), Mond (XXI), Sküs (★, highest).
Suit cards rank K–Q–Kn–J–10–9–8–7 (black suits) or K–Q–Kn–J–A–2–3–4 (red suits).
Suit-following (Farbzwang): follow led suit if able; if void, play a Tarock; if void in both, play any card.
Strawman piles: three face-down piles are dealt; Tarocks or Kings cascade immediately to hand; other cards become strawman tops, entering hand when their pile runs out.
Bidding: forehand may bid 'play' to become declarer, or pass; if both pass it's a no-bid hand.
Declarer needs ≥36 card points (out of 70) to win; exactly 35 is a loss.
Hand strength for bidding: bid 'play' when you hold several high tarocks (Mond XXI, Sküs ★, or multiple mid-range tarocks), Kings, or a long suit you can lead. A hand with many low tarocks and no Kings is risky to declare with.
Card points: Trull cards (★, XXI, I) and Kings = 4 each; Queens = 3; Knights = 2; Jacks = 1; counted in groups of 3.
Bonuses vary by scoring variant (Beck / Mayr-Sedlaczek): Pagat Ultimo, Trull, Royal Trull, and others.`,

  dreiertarock:
`Dreiertarock is a 3-player (or 4-player, dealer sits out) bidding Tarock game using a 54-card or 42-card deck.
Tarocks (I–XXI + Sküs ★) are permanent trumps. Key tarocks: Pagat (I), Mond (XXI), Sküs (★, highest).
Suit-following (Farbzwang): follow led suit if able; if void, play a Tarock; if void in both, play any card.
Bidding: forehand must bid (cannot pass first). Bids in ascending order: Single < Double < Triple < Quadruple < Quintuple < Solo < SoloValat. When outbid, previous holder must immediately hold (match) or pass. If all pass forehand's Single, forehand chooses Single or Trischaken.
Exchange (Single–Quintuple): both talon groups revealed; declarer picks one group; unchosen 3 go to defenders as a trick. Declarer then discards 3 cards (no Kings, Pagat, Mond, or Sküs; Tarocks II–XX only if forced).
Declaring phase: players announce bonuses (Pagat Ultimo, Uhu, Kakadu, Mond Fang, Trull, Kings) or Kontra in circular order. Announcing a bonus doubles its value; failure doubles the penalty. Kontra doubles the game value (Rekontra ×4, Subkontra ×8).
Declarer needs ≥36 card points (out of 70) to win; exactly 35 is a loss.
Trischaken (no declarer): every player for themselves; player with most card points pays the others. Pagat cannot be played until it is your last Tarock.`,
};

function formatMove(move: Move): string {
  switch (move.type) {
    case "PLAY_CARD":         return `${move.card.rank}${move.card.suit}`;
    case "MAKE_BID":          return move.bid;
    case "PASS_BID":          return "Pass bid";
    case "MAKE_ANNOUNCEMENT": return move.announcement;
    case "PASS_ANNOUNCEMENT": return "Pass";
    case "CHOOSE_CONTRACT":   return `Choose ${move.contract}`;
    case "CHOOSE_TALON":      return `Pick ${move.choice} talon group`;
    case "DISCARD_CARD":      return `Discard ${move.card.rank}${move.card.suit}`;
    case "KONTRA":            return `${move.level ?? "Kontra"} ${move.target}`;
    default:                  return (move as { type: string }).type;
  }
}

type AdvisorContext = {
  gameType: string; phase: string; trickNum: number;
  myHand: Card[]; legalMoves: Move[];
  currentTrick: { playerIndex: number; card: Card }[];
  scores: number[];
  seats: { displayName: string }[];
  contract: string | undefined;
  currentBid: string | undefined;
  declarer: number | null;
  announcements: { name: string; player: number }[];
  lastAiResponseTs: number | null;
};

function buildAdvisorPrompt(context: AdvisorContext, question: string): string {
  const rules = GAME_RULES[context.gameType] ?? "";
  const legalMoveStr = context.legalMoves.length > 0
    ? context.legalMoves.map(formatMove).join(", ")
    : "none (not your turn)";
  const trickStr = context.currentTrick.length > 0
    ? context.currentTrick.map(p =>
        `${context.seats[p.playerIndex]?.displayName ?? `Player ${p.playerIndex}`} played ${p.card.rank}${p.card.suit}`
      ).join(", ")
    : "none yet";
  const scoreStr = context.scores
    .map((s, i) => `${context.seats[i]?.displayName ?? i}: ${s}`)
    .join(", ");

  const lines = [
    `You are Judy, the tutorial advisor for Queens Hand (traditional Austrian card game app). Your tone is calm, dry, and knowledgeable — like a patient card player who has seen it all. Never use exclamation points.`,
    `Answer in 3–5 sentences maximum. Always reference the player's actual cards to make your advice concrete — don't just explain the rule in the abstract. No bullet points, no headers, no lists — plain prose only.`,
    ``,
    `=== RULES ===`,
    rules,
    ``,
    `=== GAME STATE ===`,
    `Game: ${context.gameType} | Phase: ${context.phase} | Trick ${context.trickNum}`,
    `Your hand: ${context.myHand.map(c => `${c.rank}${c.suit}`).join(" ")}`,
    `Legal moves: ${legalMoveStr}`,
    `Current trick: ${trickStr}`,
    `Scores: ${scoreStr}`,
  ];
  if (context.contract) lines.push(`Contract: ${context.contract}`);
  if (context.currentBid) lines.push(`Current bid: ${context.currentBid}`);
  if (context.declarer != null) lines.push(`Declarer: ${context.seats[context.declarer]?.displayName ?? context.declarer}`);
  if (context.announcements.length > 0) {
    lines.push(`Announcements: ${context.announcements.map(a => `${context.seats[a.player]?.displayName ?? a.player}: ${a.name}`).join(", ")}`);
  }
  lines.push(``, `=== PLAYER ASKS ===`, question);
  return lines.join("\n");
}

export const getAiAdvisorContext = internalQuery({
  args: { gameId: v.id("games"), askingPlayerId: v.id("players") },
  handler: async (ctx, { gameId, askingPlayerId }) => {
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "active") return null;

    const allSeats = await ctx.db
      .query("game_seats")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    const sortedSeats = allSeats.sort((a, b) => a.seatIndex - b.seatIndex);

    const myEngineIndex = sortedSeats.findIndex((s) => s.playerId === askingPlayerId);
    if (myEngineIndex === -1) return null;

    const publicState = await ctx.db
      .query("game_public_state")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .unique();
    if (!publicState) return null;

    const liveState = await ctx.db
      .query("game_live_state")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .unique();
    if (!liveState) return null;

    const handRow = await ctx.db
      .query("player_hands")
      .withIndex("by_game_and_player", (q) =>
        q.eq("gameId", gameId).eq("playerId", askingPlayerId)
      )
      .unique();
    const myHand = (handRow?.hand ?? []) as Card[];

    const adapter = getAdapter(game.gameType as GameType);
    const legalMoves: Move[] =
      publicState.currentTurn === myEngineIndex
        ? adapter.getLegalMoves(liveState.state)
        : [];

    const seats = await Promise.all(
      sortedSeats.map(async (seat) => {
        const player = await ctx.db.get(seat.playerId);
        return { displayName: player?.displayName ?? "Unknown" };
      })
    );

    const lastAiMsg = await ctx.db
      .query("table_messages")
      .withIndex("by_game_ai_ts", (q) => q.eq("gameId", gameId).eq("isAiResponse", true))
      .order("desc")
      .first();

    return {
      gameType: game.gameType,
      phase: publicState.phase,
      trickNum: publicState.trickNum,
      myHand,
      legalMoves,
      currentTrick: publicState.currentTrick as { playerIndex: number; card: Card }[],
      scores: publicState.scores,
      seats,
      contract: adapter.getContract(liveState.state) ?? undefined,
      currentBid: adapter.getCurrentBid(liveState.state) ?? undefined,
      declarer: adapter.getDeclarer(liveState.state),
      announcements: adapter.getAnnouncements(liveState.state),
      lastAiResponseTs: lastAiMsg?.ts ?? null,
    };
  },
});

export const insertAiResponse = internalMutation({
  args: { gameId: v.id("games"), text: v.string() },
  handler: async (ctx, { gameId, text }) => {
    await ctx.db.insert("table_messages", {
      gameId,
      displayName: "Judy",
      text,
      ts: Date.now(),
      isAiResponse: true,
    });
  },
});

export const askAiAdvisor = internalAction({
  args: {
    gameId: v.id("games"),
    askingPlayerId: v.id("players"),
    question: v.string(),
  },
  handler: async (ctx, { gameId, askingPlayerId, question }) => {
    const context = await ctx.runQuery(internal.games.getAiAdvisorContext, {
      gameId,
      askingPlayerId,
    });
    if (!context) return;

    if (context.lastAiResponseTs != null && Date.now() - context.lastAiResponseTs < 15_000) return;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;

    const prompt = buildAdvisorPrompt(context, question);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 2048 },
        }),
      }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const replyText: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!replyText) {
      console.error("Judy: no reply text extracted from Gemini response");
      await ctx.runMutation(internal.games.insertAiResponse, {
        gameId,
        text: "My thoughts are elsewhere at the moment — try asking again in a bit.",
      });
      return;
    }

    await ctx.runMutation(internal.games.insertAiResponse, {
      gameId,
      text: replyText.trim(),
    });
  },
});

// ── Cron job: cleanup stale tables and abandoned games ────────────────────────

export const cleanupStaleGames = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const WAITING_STALE_MS   = 10 * 60 * 1000;  // 10 min: delete abandoned waiting table
    const IDLE_TURN_MS       =  5 * 60 * 1000;  // 5 min idle on your turn → bot substitution
    const ACTIVE_STALE_MS    = 60 * 60 * 1000;  // 60 min with no humans → finalize game
    const PRESENCE_ONLINE_MS = 90_000;           // 90s (1.5× the 60s heartbeat TTL)

    async function hasOnlineHumans(gameId: Id<"games">): Promise<boolean> {
      const seats = await ctx.db
        .query("game_seats")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .collect();
      for (const seat of seats) {
        const player = await ctx.db.get(seat.playerId);
        if (!player || player.isBot) continue;
        const presence = await ctx.db
          .query("presence")
          .withIndex("by_user", (q) => q.eq("userId", player.userId))
          .first();
        if (presence && presence.lastSeen >= now - PRESENCE_ONLINE_MS) return true;
      }
      return false;
    }

    const [gamesWaiting, gamesActive, gamesBetweenHands] = await Promise.all([
      ctx.db.query("games").withIndex("by_status", (q) => q.eq("status", "waiting")).collect(),
      ctx.db.query("games").withIndex("by_status", (q) => q.eq("status", "active")).collect(),
      ctx.db.query("games").withIndex("by_status", (q) => q.eq("status", "between_hands")).collect(),
    ]);
    const allGames = [...gamesWaiting, ...gamesActive, ...gamesBetweenHands];

    // Step 1: Delete stale waiting tables (no online humans, > 10 min since creation)
    for (const game of allGames) {
      if (game.status !== "waiting") continue;
      if (game.startedAt >= now - WAITING_STALE_MS) continue;
      if (await hasOnlineHumans(game._id)) continue;

      const messages = await ctx.db
        .query("table_messages")
        .withIndex("by_game_ts", (q) => q.eq("gameId", game._id))
        .collect();
      for (const msg of messages) await ctx.db.delete(msg._id);

      const seats = await ctx.db
        .query("game_seats")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .collect();
      for (const seat of seats) await ctx.db.delete(seat._id);

      await ctx.db.delete(game._id);
    }

    // Step 2: Bot-substitute idle human players (active games, > 5 min idle on their turn)
    for (const game of allGames) {
      if (game.status !== "active") continue;

      const publicState = await ctx.db
        .query("game_public_state")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .first();
      if (!publicState) continue;

      const seats = await ctx.db
        .query("game_seats")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .collect();
      const sortedSeats = seats.sort((a, b) => a.seatIndex - b.seatIndex);

      // currentTurn is an engine player index; sorted seats give 1:1 mapping to seatIndex
      const idleSeat = sortedSeats[publicState.currentTurn];
      if (!idleSeat) continue;

      const idlePlayer = await ctx.db.get(idleSeat.playerId);
      if (!idlePlayer || idlePlayer.isBot) continue; // already a bot — applyBotMoves handles it

      const latestMove = await ctx.db
        .query("game_moves")
        .withIndex("by_game_seq", (q) => q.eq("gameId", game._id))
        .order("desc")
        .first();
      const lastActivity = latestMove?.ts ?? game.startedAt;
      if (lastActivity >= now - IDLE_TURN_MS) continue;

      // Count remaining human seats including this idle one
      const humanCount = (
        await Promise.all(seats.map(async (s) => {
          const p = await ctx.db.get(s.playerId);
          return p && !p.isBot;
        }))
      ).filter(Boolean).length;

      if (humanCount <= 1) continue; // last human — step 3 handles finalization

      // Swap the idle human for a fresh bot
      const botId = await ctx.db.insert("players", {
        userId: `bot_${crypto.randomUUID()}`,
        displayName: "Bot",
        isBot: true,
        ratings: {},
        createdAt: now,
      });
      await ctx.db.patch(idleSeat._id, { playerId: botId });

      const handRow = await ctx.db
        .query("player_hands")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .filter((q) => q.eq(q.field("seatIndex"), idleSeat.seatIndex))
        .first();
      if (handRow) await ctx.db.patch(handRow._id, { playerId: botId });

      await ctx.scheduler.runAfter(0, internal.games.applyBotMoves, { gameId: game._id });
    }

    // Step 3: Finalize abandoned active/between_hands games
    // (no humans online + last activity > 60 min ago)
    const activeGames = allGames.filter(
      (g) => g.status === "active" || g.status === "between_hands"
    );

    for (const game of activeGames) {
      if (await hasOnlineHumans(game._id)) continue;

      const latestMove = await ctx.db
        .query("game_moves")
        .withIndex("by_game_seq", (q) => q.eq("gameId", game._id))
        .order("desc")
        .first();
      const lastActivity = latestMove?.ts ?? game.startedAt;
      if (lastActivity >= now - ACTIVE_STALE_MS) continue;

      const seats = await ctx.db
        .query("game_seats")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .collect();
      const humanPlayers = (
        await Promise.all(
          seats.map(async (s) => {
            const p = await ctx.db.get(s.playerId);
            return p && !p.isBot ? { playerId: s.playerId, userId: p.userId } : null;
          })
        )
      ).filter((x): x is { playerId: Id<"players">; userId: string } => x !== null);

      if ((game.settings as Record<string, unknown>)?.ranked === true && humanPlayers.length > 0) {
        // Ranked abandonment: dock the player who went offline first
        const withPresence = await Promise.all(
          humanPlayers.map(async ({ playerId, userId }) => {
            const presence = await ctx.db
              .query("presence")
              .withIndex("by_user", (q) => q.eq("userId", userId))
              .first();
            return { playerId, lastSeen: presence?.lastSeen ?? 0 };
          })
        );
        const abandoner = withPresence.sort((a, b) => a.lastSeen - b.lastSeen)[0]!;
        await ctx.db.patch(game._id, {
          status: "finished",
          endedAt: now,
          result: { abandoned: true, abandonerPlayerId: abandoner.playerId },
        });
      } else {
        await ctx.db.patch(game._id, { status: "finished", endedAt: now });
      }

      const liveRows = await ctx.db
        .query("game_live_state")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .collect();
      for (const row of liveRows) await ctx.db.delete(row._id);

      const publicRows = await ctx.db
        .query("game_public_state")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .collect();
      for (const row of publicRows) await ctx.db.delete(row._id);

      const handRows = await ctx.db
        .query("player_hands")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .collect();
      for (const row of handRows) await ctx.db.delete(row._id);
    }
  },
});
