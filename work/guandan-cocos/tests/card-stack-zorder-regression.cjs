const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const handController = fs.readFileSync(path.join(root, 'assets/scripts/ui/HandController.ts'), 'utf8')

assert.doesNotMatch(handController, /selectedStacks/, 'a selected grouped card must never raise or reorder its locked stack')
assert.doesNotMatch(handController, /leftSelectedLoose|rightSelectedLoose/, 'selection must not alter z-order for any hand card')
assert.match(
  handController,
  /laneDifference[\s\S]*?left\.slot\.stackIndex[\s\S]*?right\.slot\.stackIndex/,
  'sibling order must compare the visual lane before stackIndex',
)
assert.doesNotMatch(
  handController,
  /if \(left\.selected !== right\.selected\) return left\.selected \? 1 : -1/,
  'raw selected state must not reorder members inside a stack',
)
const orderStart = handController.indexOf('const orderedNodes =')
const orderEnd = handController.indexOf('orderedNodes.forEach', orderStart)
assert.notEqual(orderStart, -1)
assert.notEqual(orderEnd, -1)
assert.doesNotMatch(handController.slice(orderStart, orderEnd), /selected|locked/, 'visual state must not participate in sibling ordering')
assert.doesNotMatch(handController, /node\.setScale/, 'hand layout must never scale individual card nodes')

const orderCards = entries => {
  return entries.slice().sort((left, right) => {
    const laneDifference = left.laneIndex - right.laneIndex
    if (laneDifference) return laneDifference
    return left.stackIndex - right.stackIndex
  }).map(entry => entry.id)
}

const stackWithCoveredSelection = [
  { id: 'loose-left', selected: false, stackId: null, laneIndex: 0, stackIndex: 0 },
  { id: 'stack-top', selected: true, stackId: 'bomb', laneIndex: 1, stackIndex: 0 },
  { id: 'stack-cover-1', selected: false, stackId: 'bomb', laneIndex: 1, stackIndex: 1 },
  { id: 'stack-cover-2', selected: false, stackId: 'bomb', laneIndex: 1, stackIndex: 2 },
  { id: 'loose-right', selected: false, stackId: null, laneIndex: 2, stackIndex: 0 },
]
assert.deepEqual(
  orderCards(stackWithCoveredSelection),
  ['loose-left', 'stack-top', 'stack-cover-1', 'stack-cover-2', 'loose-right'],
  'a selected covered card must keep both its lane and internal stack order',
)

const looseSelection = stackWithCoveredSelection.map(entry => ({ ...entry, selected: entry.id === 'loose-left' }))
assert.deepEqual(
  orderCards(looseSelection),
  ['loose-left', 'stack-top', 'stack-cover-1', 'stack-cover-2', 'loose-right'],
  'a selected loose card must retain its ordinary lane order',
)

console.log('card stack z-order regression checks passed')
