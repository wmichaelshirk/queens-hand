export function shuffle<T> (deck: T[]): T[] {
    return deck.sort(() => Math.random() - 0.5)
}

