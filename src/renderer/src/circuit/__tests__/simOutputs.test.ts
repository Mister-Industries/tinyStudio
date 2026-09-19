/**
 * core/simOutputs + the analysis sizing guard (spec §10.4).
 *
 * The point of these: an output reference must survive edits that renumber the
 * netlist's nodes (that's the whole reason we don't persist `v(n3)`), and an
 * analysis that would allocate gigabytes must be caught before it reaches the
 * engine rather than after it takes the renderer down.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseCircuitFile,
  serializeDoc,
  emptyDoc,
  type CircuitPart,
  type CircuitWire
} from '../core/model'
import { buildNets } from '../core/nets'
import { estimatePoints, generateNetlist, spiceValue, MAX_SIM_POINTS } from '../core/netlist'
import {
  availableOutputs,
  makeProbe,
  netLabelFor,
  probeAnchor,
  probeFor,
  PROBE_DEFAULT_OFFSET,
  netOutputRef,
  netIndexOfOutput,
  outputFilter,
  outputLabelFor,
  parseOutputRef,
  resolveOutputs,
  vectorForOutput
} from '../core/simOutputs'

let wid = 0
const wire = (from: string, to: string): CircuitWire => ({
  id: `w${++wid}`,
  from,
  to,
  view: 'sch'
})
const part = (id: string, type: string, attrs?: CircuitPart['attrs']): CircuitPart => ({
  id,
  type,
  attrs,
  sch: { x: 0, y: 0 }
})

/** V1 → R1 → R2 → GND, with the midpoint labelled OUT. */
function divider(): ReturnType<typeof emptyDoc> {
  const doc = emptyDoc()
  doc.parts = [
    part('V1', 'sim-vdc', { voltage: '5' }),
    part('R1', 'resistor', { resistance: '10k' }),
    part('R2', 'resistor', { resistance: '4.7k' })
  ]
  doc.netLabels = [
    { id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } },
    { id: 'nl2', name: 'OUT', kind: 'net', sch: { x: 0, y: 0 } }
  ]
  doc.wires = [
    wire('V1:+', 'R1:Pin 0'),
    wire('R1:Pin 1', 'R2:Pin 0'),
    wire('R2:Pin 1', 'V1:-'),
    wire('nl1:1', 'V1:-'),
    wire('nl2:1', 'R1:Pin 1')
  ]
  return doc
}

test('available outputs list the measurable nets and source currents, not ground', () => {
  const doc = divider()
  const net = buildNets(doc)
  const choices = availableOutputs(doc, net)
  const labels = choices.map((c) => c.label)

  assert.ok(labels.includes('OUT'), `the named midpoint is offered (got ${labels.join(', ')})`)
  assert.ok(!labels.includes('GND'), 'ground is 0 by definition, never an output')
  assert.ok(
    choices.some((c) => c.kind === 'i' && c.label === 'I(V1)'),
    'the voltage source can report its current'
  )
  // every voltage choice must round-trip through parse
  for (const c of choices) assert.ok(parseOutputRef(c.ref), `${c.ref} parses`)
})

test('an output reference survives a node renumber', () => {
  const doc = divider()
  let net = buildNets(doc)
  const ref = netOutputRef(net, 'R1:Pin 1')
  assert.ok(ref, 'the midpoint has a reference')

  let gen = generateNetlist(doc, net)
  const before = vectorForOutput(ref!, net, gen)
  assert.equal(before, 'v(out)')

  // add an unrelated branch, enough to shift the n<k> numbering around
  doc.parts.push(part('R3', 'resistor', { resistance: '1k' }))
  doc.wires.push(wire('V1:+', 'R3:Pin 0'), wire('R3:Pin 1', 'V1:-'))
  net = buildNets(doc)
  gen = generateNetlist(doc, net)

  const after = vectorForOutput(ref!, net, gen)
  assert.equal(after, 'v(out)', 'the same reference still names the same node')
  assert.equal(netIndexOfOutput(ref!, net), net.pinToNet.get('R1:Pin 1'))
})

test('a current output resolves to the device ngspice actually emitted', () => {
  const doc = divider()
  const net = buildNets(doc)
  const gen = generateNetlist(doc, net)
  assert.equal(vectorForOutput('i@V1', net, gen), 'i(vv1)')
  assert.equal(vectorForOutput('i@nope', net, gen), undefined)
})

test('no picks means every vector plots; a pick narrows to it', () => {
  const doc = divider()
  const net = buildNets(doc)
  const gen = generateNetlist(doc, net)

  const none = outputFilter(resolveOutputs([], doc, net, gen))
  assert.ok(none('v(out)') && none('v(n1)') && none('i(vv1)'))

  const resolved = resolveOutputs(['v@R1:Pin 1'], doc, net, gen)
  const only = outputFilter(resolved)
  assert.ok(only('v(out)'), 'the picked node passes')
  assert.ok(!only('i(vv1)'), 'everything else is filtered out')
  assert.equal(outputLabelFor(resolved)('v(out)'), 'OUT')
})

test('an output whose part is gone degrades instead of throwing', () => {
  const doc = divider()
  const net = buildNets(doc)
  const gen = generateNetlist(doc, net)
  const [resolved] = resolveOutputs(['v@GONE:1'], doc, net, gen)
  assert.equal(resolved.vector, undefined)
  assert.equal(resolved.label, 'GONE:1')
  // an unresolvable pick must not silently blank the plot
  assert.ok(outputFilter([resolved])('v(out)'))
})

test('spiceValue reads the suffixes the schematic prints', () => {
  const near = (got: number, want: number): void =>
    assert.ok(Math.abs(got - want) <= Math.abs(want) * 1e-12, `${got} ≈ ${want}`)
  near(spiceValue('10u'), 10e-6)
  assert.equal(spiceValue('4.7k'), 4700)
  assert.equal(spiceValue('1M'), 1e6) // human megohm convention
  near(spiceValue('1m'), 1e-3)
  assert.equal(spiceValue('1e3'), 1000)
  assert.equal(spiceValue('220'), 220)
})

test('analysis point counts are estimated before the engine allocates them', () => {
  assert.equal(estimatePoints({ id: 'a', kind: 'op' }), 1)
  assert.equal(estimatePoints({ id: 'a', kind: 'tran', step: '10u', stop: '10m' }), 1001)
  assert.equal(estimatePoints({ id: 'a', kind: 'dc', from: '0', to: '5', step: '0.1' }), 51)
  // 6 decades at 20 points/decade
  assert.equal(
    estimatePoints({
      id: 'a',
      kind: 'ac',
      variation: 'dec',
      points: '20',
      fstart: '1',
      fstop: '1Meg'
    }),
    121
  )
  // the shape that used to take the app down with it
  assert.ok(
    estimatePoints({ id: 'a', kind: 'tran', step: '1n', stop: '10' }) > MAX_SIM_POINTS,
    'a nanosecond step over ten seconds is refused'
  )
  // nonsense parameters estimate to nothing rather than NaN/Infinity
  assert.equal(estimatePoints({ id: 'a', kind: 'tran', step: '0', stop: '1' }), 0)
})

// ── placed probes ────────────────────────────────────────────────────────────

test('a probe anchors to the pin it was picked from, in both views', () => {
  const doc = divider()
  const net = buildNets(doc)
  const ref = netOutputRef(net, 'R1:Pin 1')!
  const probe = makeProbe(ref, 'sch', [12, -30])

  assert.equal(probe.kind, 'voltage')
  assert.equal(probe.at, ref)
  assert.deepEqual(probe.sch, [12, -30], 'the view it was placed in keeps the drop point')
  assert.deepEqual(
    probe.bb,
    PROBE_DEFAULT_OFFSET,
    'the other view still gets a tag rather than losing it'
  )

  const anchor = probeAnchor(ref)
  assert.deepEqual(anchor, { kind: 'v', part: 'R1', pin: 'Pin 1' })
})

test('a current probe anchors to the part, not a pin', () => {
  assert.deepEqual(probeAnchor('i@V1'), { kind: 'i', part: 'V1' })
  assert.equal(makeProbe('i@V1', 'sch').kind, 'current')
  assert.equal(makeProbe('d@P1', 'sch').kind, 'diff')
})

test('probeFor finds the tag already measuring a node (so picking toggles)', () => {
  const doc = divider()
  const net = buildNets(doc)
  const ref = netOutputRef(net, 'R1:Pin 1')!
  const probes = [makeProbe('i@V1', 'sch'), makeProbe(ref, 'sch')]
  assert.equal(probeFor(probes, ref)?.at, ref)
  assert.equal(probeFor(probes, 'v@nothing:1'), undefined)
})

test('probes survive a save/load round trip', () => {
  const doc = divider()
  const net = buildNets(doc)
  const probe = makeProbe(netOutputRef(net, 'R1:Pin 1')!, 'sch', [8, -24])
  doc.sim = { probes: [probe] }

  const reloaded = parseCircuitFile(serializeDoc(doc)).doc
  assert.deepEqual(reloaded.sim?.probes, [probe])
})

test('a tag reads the same node name the netlist will emit', () => {
  const doc = divider()
  const net = buildNets(doc)
  const gen = generateNetlist(doc, net)
  net.nets.forEach((members, i) => {
    if (members.length < 2) return
    const label = netLabelFor(net, i)
    const node = gen.nodeOfNet[i]
    if (node === '0') return // ground is never tagged
    assert.equal(label, node, `net ${i} tag and netlist node agree`)
  })
})
