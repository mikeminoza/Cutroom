import { describe, expect, it } from 'vitest'
import type { ProjectFull } from '../src/lib/dto'
import { scenePrompts, scenePromptsText } from '../src/lib/scene-prompts'

const scene = (index: number, start: number, end: number, extra: Record<string, unknown> = {}) => ({
  id: `s${index}`,
  index,
  start,
  end,
  narration: `Line ${index + 1}.`,
  visual: `Picture ${index + 1}`,
  imagePrompt: '',
  characters: [] as string[],
  shot: 'wide',
  imageUrl: null as string | null,
  ...extra,
})

const data = {
  project: { title: 'Octopus facts', artStyle: 'Bold flat illustration', format: 'landscape' },
  scenes: [scene(0, 0, 5.2, { imageUrl: '/api/files/a.png' }), scene(1, 5.2, 9.8, { characters: ['Milo'] })],
  characters: [{ id: 'c1', name: 'Milo', description: 'A purple octopus', images: [] }],
} as unknown as ProjectFull

describe('timestamps and image prompts', () => {
  it('gives each scene its time range, prompt, characters and picture status', () => {
    const entries = scenePrompts(data)
    expect(entries.map((e) => e.range)).toEqual(['0:00.0 – 0:05.2', '0:05.2 – 0:09.8'])
    expect(entries[0].prompt).toContain('Picture 1')
    expect(entries[0].hasImage).toBe(true)
    expect(entries[1].hasImage).toBe(false)
    expect(entries[1].cast).toEqual(['Milo'])
  })

  it('writes the storyboard: one block per scene, with its narration and the characters to attach', () => {
    const text = scenePromptsText(scenePrompts(data))
    const blocks = text.split('────────────────────────────────────────')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatch(/^Scene 1 {2}\(0:00\.0 – 0:05\.2\)\nNarration: “Line 1\.”\n\nImage prompt: /)
    expect(blocks[1]).toContain(
      'Scene 2  (0:05.2 – 0:09.8)\nNarration: “Line 2.”\nAttach reference images for: Milo\n\nImage prompt: ',
    )
  })
})
