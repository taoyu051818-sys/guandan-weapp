const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const handController = fs.readFileSync(path.join(root, 'assets/scripts/ui/HandController.ts'), 'utf8')

assert.doesNotMatch(handController, /selectedStacks/, 'a selected grouped card must never raise or reorder its locked stack')
assert.match(handController, /const leftSelectedLoose = !left\.slot\.stackId && left\.selected/, 'only ungrouped cards may receive selected-card z-order')
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

const orderCards = entries => {
  return entries.slice().sort((left, right) => {
    const leftSelectedLoose = !left.stackId && left.selected
    const rightSelectedLoose = !right.stackId && right.selected
    if (leftSelectedLoose !== rightSelectedLoose) return leftSelectedLoose ? 1 : -1
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
  ['stack-top', 'stack-cover-1', 'stack-cover-2', 'loose-right', 'loose-left'],
  'a selected loose card must still render above unrelated cards and stacks',
)

console.log('card stack z-order regression checks passed')
