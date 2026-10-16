import type { JudgeAdvice, PanelAdvice, PanelFinding } from '../../shared/domain/panel'
import { fixtureBobFinding } from './bob'

export function fixturePanelFinding(changes: Partial<PanelFinding> = {}): PanelFinding {
  return { ...fixtureBobFinding(), tag: 'code', ...changes }
}

export function fixturePanelAdvice(
  findings: PanelFinding[] = [fixturePanelFinding()],
): PanelAdvice {
  return {
    verdict: findings.length ? 'changes' : 'clean',
    summary: 'The permission rule reads clearly.',
    findings,
    good: [],
    limitations: [],
  }
}

export function fixtureJudgeAdvice(raisedBy: string[] = ['unclebob']): JudgeAdvice {
  return {
    verdict: 'changes',
    summary: 'Reuse the audit helper.',
    findings: [{ ...fixturePanelFinding(), raisedBy }],
    setAside: [],
    good: [],
    limitations: [],
    disagreements: [],
  }
}
