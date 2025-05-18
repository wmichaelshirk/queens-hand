// Bondtolva
// https://sv.wikipedia.org/wiki/Bondtolva

import { shuffle } from "./utils"

const MATADORS = ['A', 'T']
const GAME_TARGET = 12

type Phases = 'deal' | 'stock-open' | 'stock-closed' | 'scoring' | 'end'
const SUITS = ['H', 'S', 'D', 'C']
type Suit = typeof SUITS[number]
const RANKS = ['K', 'T', 'Q', 'J', '9']
type Rank = typeof RANKS[number]
type Card = `${Rank}-${Suit}`

type PlayerState = {
    hand: Card[]
    marriages: Suit[]
    tricksWon: Card[]
    currentScore: number
}

type PlayerId = string

type MoveTypes = 'play' | 'declare-marriage' 
type PlayCardMove = {
    type: 'play'
    card: Card
    player: PlayerId
}
type DeclareMarriageMove = {
    type: 'declare-marriage'
    card: Card
    player: PlayerId
}

type Move = PlayCardMove | DeclareMarriageMove 

type GameState = {
    players: [PlayerId, PlayerId] 
    playerStates: {
        [key: PlayerId]: PlayerState
    }
    currentTrick: {
        player: PlayerId
        card: Card
    }[]
    trump: Suit | null
    stock: Card[]
    currentPlayer: PlayerId
    dealer: PlayerId

    phase: Phases
}





/* 
 * Game logic
 */
export function getValidMoves (gameState: GameState): Move[] {
    const { currentPlayer, phase } = gameState
    const currentPlayerHand = gameState.playerStates[currentPlayer].hand
    let validMoves: Move[] = []

    if (phase === 'deal') return validMoves

    if (phase === 'stock-open') {
        // Any card may be played; marriages may be declare if on lead.
        validMoves = currentPlayerHand.map(card => ({
            type: 'play',
            card,
            player: currentPlayer,
        }))
        if (gameState.currentTrick.length === 0) {
            // if the player has a K and Q of the same suit, they can declare a marriage
            // by leading one of them.
            const marriages = getMarriages(currentPlayerHand)
            marriages.forEach(card => {
                validMoves.push({
                    type: 'declare-marriage',
                    card,
                    player: currentPlayer,
                })
            })
        }
    }

    if (phase === 'stock-closed') {
        // Any card may be led; 
        // But suit must be followed and the trick must be headed if possible.
        if (gameState.currentTrick.length === 0) {
            // Any card may be led.
            validMoves = currentPlayerHand.map(card => ({
                type: 'play',
                card,
                player: currentPlayer,
            }))
        } else {
            // Suit must be followed and the trick must be headed if possible.'
            const suitLed = gameState.currentTrick[0].card.split('-')[1]

            const currentPlayerHandSuits = currentPlayerHand.map(card => {
                const [rank, suit] = card.split('-')
                return ({
                    rank,
                    suit,
                    rankHeight: RANKS.indexOf(rank)
                })
            })
            const hasSuitLed = currentPlayerHandSuits.some(card => card.suit === suitLed)
            const hasTrumps = gameState.trump && currentPlayerHandSuits.some(card => card.suit === gameState.trump)
            
            if (hasSuitLed) {
                const validCards = currentPlayerHandSuits.filter(card => card.suit === suitLed)
                const canHead = validCards.some(card => card.rankHeight < RANKS.indexOf(suitLed))
                if (canHead) {
                    validMoves = validCards.filter(card => card.rankHeight < RANKS.indexOf(suitLed))
                        .map(card => ({
                            type: 'play',
                            card: `${card.rank}-${card.suit}`,
                            player: currentPlayer,
                        }))
                } else {
                    validMoves = validCards.map(card => ({
                        type: 'play',
                        card: `${card.rank}-${card.suit}`,
                        player: currentPlayer,
                    }))
                }
            } else if (hasTrumps) {
                validMoves = currentPlayerHandSuits.filter(card => card.suit === gameState.trump)
                    .map(card => ({
                        type: 'play',
                        card: `${card.rank}-${card.suit}`,
                        player: currentPlayer,
                    }))
            } else {
                validMoves = currentPlayerHand.map(card => ({
                    type: 'play',
                    card,
                    player: currentPlayer,
                }))
            }
        }
    }

    return validMoves
}


export function makeMove(gameState: GameState, move: Move): GameState {
    if (!getValidMoves(gameState).includes(move)) {
        throw new Error('Invalid move')
    }

    const newState = structuredClone(gameState)
    const { phase } = newState
    let { type, card, player } = move

    if (type === 'declare-marriage') {
        newState.playerStates[player].marriages.push(card.split('-')[1])
        if (newState.trump === null) {
            newState.trump = card.split('-')[1]
            newState.playerStates[player].currentScore += 2
        } else {
            newState.playerStates[player].currentScore += 1
        }
        type = 'play'
    }

    if (type === 'play') {
        newState.playerStates[player].hand = newState.playerStates[player].hand.filter(c => c !== card)
        newState.currentTrick.push({
            player,
            card,
        })
    }

    // check if the trick is not yet complete complete
    if (newState.currentTrick.length === 1) {
        newState.currentPlayer = newState.players[(newState.players.indexOf(player) + 1) % 2]
        return newState
    }

    // determine trick winner, move trick cards, and add from the stock (if remaining)
    let trickWinner
    const trickTrumps = newState.currentTrick.filter(play => play.card.split('-')[1] === newState.trump)
    if (trickTrumps.length == 1) {
        trickWinner = trickTrumps[0].player
    } else {
        let suitLed = newState.currentTrick[0].card.split('-')[1]
        let trickFollowed = newState.currentTrick.filter(play => play.card.split('-')[1] === suitLed)
        trickWinner = trickFollowed.reduce((acc, el) => 
            RANKS.indexOf(el.card.split('-')[0]) < 
            RANKS.indexOf(acc.card.split('-')[0]) ? el : acc
        , trickFollowed[0]).player
    }
    newState.playerStates[trickWinner].tricksWon = [
        ...newState.playerStates[trickWinner].tricksWon, 
        ...newState.currentTrick.map(play => play.card)
    ]
    newState.currentTrick = []
    newState.currentPlayer = trickWinner
    if (phase === 'stock-open') {
        // give the trick winner the top card of the stock;
        // then give the other player the next top card of the stock
        newState.playerStates[trickWinner].hand.push(newState.stock.pop()!)
        newState.playerStates[newState.players[(newState.players.indexOf(trickWinner) + 1) % 2]]
            .hand.push(newState.stock.pop()!)
    } 

    // check if the stock is empty
    if (newState.stock.length === 0) {
        newState.phase = 'stock-closed'
    }

    // check if the round is complete
    if (newState.players.every(player => newState.playerStates[player].hand.length === 0)) {
        // if so, winner of last trick gets a point; 
        newState.playerStates[trickWinner].currentScore += 1

        // winner of the most matadors (That is, the most A and T) gets a point.
        // If there is a tie, the player with the most card points (A=4, K=3, Q=2, J=1, 9=0) gets the point.
        // If that is also a tie, no one scores.
        const matadors = newState.players.map(player => ({
            player,
            matadors: newState.playerStates[player].tricksWon.filter(card => MATADORS.includes(card.split('-')[0])).length
        }))
        matadors.sort((a, b) => {
            if (a.matadors > b.matadors) return -1
            if (a.matadors < b.matadors) return 1
            return 0
        })
        const matadorWinner = new Set(matadors.map(m => m.matadors)).size === 2 ? matadors[0].player : null

        if (matadorWinner) {
            newState.playerStates[matadorWinner].currentScore += 1
        } else {
            const cardPoints = newState.players.map(player => ({
                player,
                points: newState.playerStates[player].tricksWon.reduce((acc, card) => {
                    acc += {
                        'A': 4,
                        'K': 3,
                        'Q': 2,
                        'J': 1,
                    }[card.split('-')[0]] ?? 0
                    return acc
                }, 0)
            }));
            cardPoints.sort((a, b) => {
                if (a.points > b.points) return -1
                if (a.points < b.points) return 1
                return 0
            })
            const cardWinner = new Set(cardPoints.map(p => p.points)).size === 2 ? cardPoints[0].player : null
            if (cardWinner) {
                newState.playerStates[cardWinner].currentScore += 1
            }
        }
        newState.phase = 'scoring'
    }

    // check if the game is over
    const playerScores = newState.players.map(player => newState.playerStates[player].currentScore)
    if (playerScores.some(score => score >= GAME_TARGET)) {
        newState.phase = 'end'
    }
    return newState
}


/*
 * Helper functions
 */
function buildDeck (): Card[] {
    const deck: Card[] = []
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push(`${rank}-${suit}`)
        }
    }
    return deck
}



function initialState (players: [PlayerId, PlayerId]): GameState {

    const dealer = players[Math.floor(Math.random() * 2)]
    const eldest = players.find(player => player !== dealer)!
    // sort players so that Elders is first, Dealer is last.

    const gameState: GameState = {
        players: [eldest, dealer],
        playerStates: {
            [players[0]]: {
                hand: [],
                marriages: [],
                tricksWon: [],
                currentScore: 0,
            },
            [players[1]]: {
                hand: [],
                marriages: [],
                tricksWon: [],
                currentScore: 0,
            },
        },
        currentTrick: [],
        trump: null,
        stock: [],
        currentPlayer: eldest,
        dealer,
        phase: 'deal',  
    }
    return gameState
}

function deal (deck: Card[], gameState: GameState): GameState {
    const stock = [...deck]
    const newState = structuredClone(gameState)

    // shuffle the deck, and deal 6 cards to each player in groups of 3
    shuffle(stock)
    for (let i = 0; i < 12; i++) {
        newState.playerStates[newState.players[Math.floor(i / 3) % 2]].hand.push(stock.pop()!)
    }

    newState.phase = 'stock-open'
    newState.stock = deck
    return newState
}

function getMarriages(hand: Card[]): Card[] {
    const cardsBySuit = hand.reduce<Record<Suit, Card[]>>((acc, el) => {
        const [_, suit] = el.split('-')
        acc[suit].push(el)
        return acc
    }, {
        'H': [],
        'S': [],
        'D': [],
        'C': [],
    })
        // Check each suit for K and Q
    return SUITS.filter(suit => 
        cardsBySuit[suit].find(card => card.includes('K')) && 
        cardsBySuit[suit].find(card => card.includes('Q'))
    ).map(suit => cardsBySuit[suit])
    .flat()
}
