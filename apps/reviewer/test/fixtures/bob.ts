import type { BobAdvice, BobFinding } from '../../shared/domain/bob'
import { fixtureFinding } from './finding'
export { required } from './required'

export function fixtureBobFinding(): BobFinding {
  return fixtureFinding()
}
export function fixtureBobAdvice(): BobAdvice {
  return {
    verdict: 'changes',
    summary: 'The permission rule reads clearly. Reuse the existing audit helper.',
    findings: [fixtureBobFinding()],
    good: ['canEditProject names the permission rule.'],
    limitations: [],
    disagreements: [],
  }
}
