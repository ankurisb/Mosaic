import { describe, it, expect } from 'vitest'
import { normalizeKey, stemKey, matchScore, edgeId, nodeId, subgraph, type Graph } from './graph-model'

describe('graph identity primitives', () => {
  it('normalizeKey strips case and separators', () => {
    expect(normalizeKey('GM-01_000.009 ')).toBe('gm01000009')
  })
  it('stemKey drops a single trailing role suffix letter', () => {
    expect(stemKey('GM01000009P')).toBe(stemKey('GM01000009'))
    expect(stemKey('GM01000009')).toBe('gm01000009')
  })
  it('matchScore: exact = 1, shared stem = 0.85, unrelated low', () => {
    expect(matchScore('GM01000009', 'gm01000009').score).toBe(1)
    const stem = matchScore('GM01000009', 'GM01000009P')
    expect(stem.score).toBe(0.85)
    expect(stem.reason).toContain('stem')
    expect(matchScore('Warehouse W1', 'GM01000009').score).toBeLessThan(0.6)
  })
  it('edgeId orders same_as endpoints so A↔B == B↔A', () => {
    expect(edgeId('a', 'b', 'same_as')).toBe(edgeId('b', 'a', 'same_as'))
    expect(edgeId('a', 'b', 'contains')).not.toBe(edgeId('b', 'a', 'contains'))
  })
  it('nodeId is deterministic', () => {
    expect(nodeId('database', 'c1', 'asset', 'M9')).toBe('database:c1:asset:M9')
  })
})

describe('subgraph traversal', () => {
  const g: Graph = {
    nodes: [
      { id: 'p', source_type: 'database', source_id: 'c', kind: 'plant', natural_key: 'p', label: 'P', props: {}, status: 'active' },
      { id: 'l', source_type: 'database', source_id: 'c', kind: 'line', natural_key: 'l', label: 'L', props: {}, status: 'active' },
      { id: 'm', source_type: 'database', source_id: 'c', kind: 'asset', natural_key: 'm', label: 'M', props: {}, status: 'active' },
      { id: 'island', source_type: 'api', source_id: 'a', kind: 'source', natural_key: 'i', label: 'I', props: {}, status: 'active' },
    ],
    edges: [
      { id: 'e1', src: 'p', dst: 'l', type: 'contains', provenance: 'data', confidence: null, status: 'verified', evidence: '' },
      { id: 'e2', src: 'l', dst: 'm', type: 'contains', provenance: 'data', confidence: null, status: 'verified', evidence: '' },
    ],
  }
  it('expands from a seed up to depth, and excludes the island', () => {
    const sub = subgraph(g, ['p'], 2)
    const ids = sub.nodes.map(n => n.id).sort()
    expect(ids).toEqual(['l', 'm', 'p'])
    expect(ids).not.toContain('island')
  })
  it('depth 1 reaches only direct neighbours', () => {
    const sub = subgraph(g, ['p'], 1)
    expect(sub.nodes.map(n => n.id).sort()).toEqual(['l', 'p'])
  })
})
