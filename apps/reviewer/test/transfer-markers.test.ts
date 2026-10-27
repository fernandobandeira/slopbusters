// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { markTransferRows } from '../src/features/review/diff/transferMarkers'
import { TransferKind } from '../shared/domain/types'

it('marks transferred code rows and line numbers, and clears rows that stop matching', () => {
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <div data-line-type="change-deletion" data-column-number="10"></div>
    <div data-line-type="change-deletion" data-line="10"></div>
    <div data-line-type="change-addition" data-line="10"></div>
    <div data-line-type="context" data-line="11" data-transfer="moved"></div>`
  const marked = () =>
    [...root.querySelectorAll('[data-line-type]')].map((row) => row.getAttribute('data-transfer'))

  markTransferRows(root, new Map([['LEFT:10', TransferKind.moved]]))
  expect(marked()).toEqual(['moved', 'moved', null, null])

  markTransferRows(root, undefined)
  expect(marked()).toEqual([null, null, null, null])
})
