import { describe, expect, it } from 'vitest'
import { applyResult, applyRoundTestForgot, startCard } from '../src/domain/srs'

const I = [1, 3, 7, 14, 30]

describe('srs', () => {
  it('startCard', () => {
    expect(startCard('2026-11-01', I)).toEqual({ stage: 0, anchorOn: '2026-11-01', nextReviewOn: '2026-11-02' })
  })

  it('毎回期日どおりに覚えていれば予定日が順に並び、最後に卒業する', () => {
    let card = startCard('2026-11-01', I)
    const dates = [card.nextReviewOn]
    let graduated = false
    for (let i = 0; i < 5 && !graduated; i++) {
      const r = applyResult(card, 'remembered', card.nextReviewOn, I)
      graduated = r.graduated
      if (!graduated) dates.push(r.nextReviewOn)
      else expect(card.nextReviewOn).toBe('2026-12-01')
      card = { stage: r.stage, anchorOn: r.anchorOn, nextReviewOn: r.nextReviewOn }
    }
    expect(dates).toEqual(['2026-11-02', '2026-11-04', '2026-11-08', '2026-11-15', '2026-12-01'])
    expect(graduated).toBe(true)
  })

  it('stage1 で forgot → stage0、続けて remembered で anchor 基準', () => {
    const c = { stage: 1, anchorOn: '2026-11-01', nextReviewOn: '2026-11-04' }
    const f = applyResult(c, 'forgot', '2026-11-04', I)
    expect(f).toMatchObject({ stage: 0, anchorOn: '2026-11-04', nextReviewOn: '2026-11-05', graduated: false })
    const r = applyResult(f, 'remembered', '2026-11-05', I)
    expect(r.nextReviewOn).toBe('2026-11-07')
    expect(r.stage).toBe(1)
  })

  it('stage3 で forgot → today+7', () => {
    const c = { stage: 3, anchorOn: '2026-11-01', nextReviewOn: '2026-11-15' }
    const f = applyResult(c, 'forgot', '2026-11-15', I)
    expect(f.stage).toBe(2)
    expect(f.nextReviewOn).toBe('2026-11-22')
  })

  it('stage0 で forgot → stage0, today+1', () => {
    const c = { stage: 0, anchorOn: '2026-11-01', nextReviewOn: '2026-11-02' }
    const f = applyResult(c, 'forgot', '2026-11-02', I)
    expect(f).toMatchObject({ stage: 0, anchorOn: '2026-11-02', nextReviewOn: '2026-11-03' })
  })

  it('大幅に遅れて remembered し next が過去なら today+1', () => {
    const c = { stage: 1, anchorOn: '2026-11-01', nextReviewOn: '2026-11-04' }
    const r = applyResult(c, 'remembered', '2026-11-14', I)
    expect(r.stage).toBe(2)
    expect(r.nextReviewOn).toBe('2026-11-15')
  })

  it('stage が段階数を超えていたら最終段階として扱う', () => {
    const c = { stage: 6, anchorOn: '2026-11-01', nextReviewOn: '2026-11-08' }
    const r = applyResult(c, 'remembered', '2026-11-08', [1, 3, 7])
    expect(r.graduated).toBe(true)
  })

  it('applyRoundTestForgot', () => {
    const c = { stage: 2, anchorOn: '2026-11-01', nextReviewOn: '2026-11-08' }
    expect(applyRoundTestForgot(c, '2026-11-10', [1, 3, 7])).toEqual({ stage: 1, anchorOn: '2026-11-10', nextReviewOn: '2026-11-11' })
  })

  it('applyRoundTestForgot: stage が段階数を超えていたら最終段階から 1 つ戻す', () => {
    const c = { stage: 6, anchorOn: '2026-11-01', nextReviewOn: '2026-11-08' }
    expect(applyRoundTestForgot(c, '2026-11-10', [1, 3, 7])).toEqual({ stage: 1, anchorOn: '2026-11-10', nextReviewOn: '2026-11-11' })
  })

  it('applyRoundTestForgot: stage 0 は 0 のまま', () => {
    const c = { stage: 0, anchorOn: '2026-11-01', nextReviewOn: '2026-11-02' }
    expect(applyRoundTestForgot(c, '2026-11-10', [1, 3, 7])).toEqual({ stage: 0, anchorOn: '2026-11-10', nextReviewOn: '2026-11-11' })
  })
})
