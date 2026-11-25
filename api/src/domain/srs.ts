import { addDays } from './dates'

export type Card = { stage: number; anchorOn: string; nextReviewOn: string }

export function startCard(today: string, intervals: number[]): Card {
  return { stage: 0, anchorOn: today, nextReviewOn: addDays(today, intervals[0]) }
}

export function applyResult(
  card: Card,
  result: 'remembered' | 'forgot',
  today: string,
  intervals: number[],
): Card & { graduated: boolean } {
  const last = intervals.length - 1
  const stage = Math.min(card.stage, last)
  if (result === 'remembered') {
    if (stage === last) return { ...card, stage, graduated: true }
    const next = addDays(card.anchorOn, intervals[stage + 1])
    return {
      stage: stage + 1,
      anchorOn: card.anchorOn,
      nextReviewOn: next <= today ? addDays(today, 1) : next,
      graduated: false,
    }
  }
  const newStage = Math.max(stage - 1, 0)
  return {
    stage: newStage,
    anchorOn: today,
    nextReviewOn: addDays(today, intervals[newStage]),
    graduated: false,
  }
}

export function applyRoundTestForgot(card: Card, today: string, intervals: number[]): Card {
  const stage = Math.min(card.stage, intervals.length - 1)
  return { stage: Math.max(stage - 1, 0), anchorOn: today, nextReviewOn: addDays(today, 1) }
}
