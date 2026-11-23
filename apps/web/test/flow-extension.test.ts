import { describe, expect, it } from 'vitest'
import type { ProjectFull } from '../src/lib/dto'
import { flowSummary } from '../src/lib/flow-extension'

const scene = (index: number, imageUrl: string | null) => ({
  id: `s${index}`,
  index,
  start: index * 3,
  end: index * 3 + 3,
  narration: `Line ${index + 1}.`,
  visual: '',
  imagePrompt: '',
  characters: [] as string[],
  shot: '',
  imageUrl,
})

const data = {
  project: { id: 'p1', title: 'Octopus facts', script: 'Octopuses have three hearts.' },
  scenes: [scene(0, '/api/files/a.png'), scene(1, null), scene(2, null)],
  characters: [],
} as unknown as ProjectFull

describe('the project as the Flow extension sees it', () => {
  it('says whether it has a script, and how many scenes still need a picture', () => {
    expect(flowSummary(data)).toEqual({
      projectId: 'p1',
      title: 'Octopus facts',
      hasScript: true,
      scenes: 3,
      missing: 2,
    })
    const empty = {
      ...data,
      project: { ...data.project, script: '  ' },
      scenes: [],
    } as unknown as ProjectFull
    expect(flowSummary(empty)).toMatchObject({ hasScript: false, scenes: 0, missing: 0 })
  })
})
