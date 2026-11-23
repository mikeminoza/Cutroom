import { describe, expect, it } from 'vitest'
import { currentProject, itemsFromCutroom, mainCharacter, projectOffer, siteOrigin } from '../lib/cutroom.js'
import { shapePrompt, wantsCharacter } from '../lib/prompt.js'

const scene = (number, extra = {}) => ({
  id: `scene-${number}`,
  number,
  range: { start: (number - 1) * 3, end: number * 3, label: `0:0${number - 1}.0 – 0:0${number}.0` },
  narration: `Line ${number}`,
  cast: [],
  prompt: `Picture ${number}.\nShot: medium shot.\nStyle: doodle.\nFormat: 16:9 widescreen.`,
  hasImage: false,
  ...extra,
})

const picture = (name) => ({ name, type: 'image/png', dataUrl: `data:image/png;base64,${btoa(name)}` })

describe('a project sent from Cutroom', () => {
  it('becomes storyboard items that know their Cutroom scene', () => {
    const items = itemsFromCutroom({ scenes: [scene(1, { cast: ['Cappy'] }), scene(2)] })
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      number: 1,
      sceneId: 'scene-1',
      range: { start: 0, end: 3, label: '0:00.0 – 0:01.0' },
      narration: 'Line 1',
      cast: ['Cappy'],
      status: 'todo',
      files: [],
      character: 'auto',
      related: 'auto',
    })
    // The prompt keeps its Shot, Style and Format lines, as a pasted storyboard does.
    expect(items[0].prompt.split('\n')).toHaveLength(4)
  })

  it('starts scenes that already have a picture as done', () => {
    const items = itemsFromCutroom({ scenes: [scene(1, { hasImage: true }), scene(2)] })
    expect(items.map((item) => item.status)).toEqual(['done', 'todo'])
    expect(items[0].files).toEqual(['in Cutroom'])
  })

  it('keeps your choices on a scene when the same project is sent again', () => {
    const first = itemsFromCutroom({ scenes: [scene(1), scene(2)] })
    first[1].character = 'off'
    first[1].related = '1'
    const again = itemsFromCutroom({ scenes: [scene(1), scene(2)] }, first)
    expect(again[1]).toMatchObject({ character: 'off', related: '1' })
    // A changed prompt is a new picture: its choices start over.
    const changed = itemsFromCutroom({ scenes: [scene(1), scene(2, { prompt: 'Something else.' })] }, first)
    expect(changed[1]).toMatchObject({ character: 'auto', related: 'auto' })
  })

  it('leaves out scenes without a prompt or number', () => {
    const items = itemsFromCutroom({
      scenes: [scene(1, { prompt: '  ' }), scene(2), { ...scene(3), number: 'x' }],
    })
    expect(items.map((item) => item.number)).toEqual([2])
  })

  it('gives the scenes that cast the character its pictures', () => {
    const [item] = itemsFromCutroom({ scenes: [scene(1, { cast: ['Cappy'], prompt: 'A cat on a sofa.' })] })
    expect(wantsCharacter(item, { name: 'Cappy' })).toBe(true)
    const prompt = shapePrompt(item, {
      character: { name: 'Cappy', pictured: true },
      withCharacter: true,
    })
    expect(prompt).toContain('Main character: Cappy')
  })
})

describe('the main character', () => {
  it('is the pictured character the most scenes call for', () => {
    const main = mainCharacter({
      scenes: [scene(1, { cast: ['Bean'] }), scene(2, { cast: ['Cappy'] }), scene(3, { cast: ['cappy'] })],
      characters: [
        { name: 'Bean', description: 'a bean', images: [picture('bean.png')] },
        {
          name: 'Cappy',
          description: 'a capybara in a hoodie',
          images: [picture('a.png'), picture('b.png')],
        },
      ],
    })
    expect(main).toMatchObject({ name: 'Cappy', looks: 'a capybara in a hoodie' })
    expect(main.images.map((image) => image.name)).toEqual(['a.png', 'b.png'])
  })

  it('skips characters without pictures, keeps at most three, and is null without any', () => {
    const many = ['1', '2', '3', '4'].map((n) => picture(`${n}.png`))
    const main = mainCharacter({
      scenes: [scene(1, { cast: ['Ghost'] })],
      characters: [
        { name: 'Ghost', description: '', images: [] },
        { name: 'Cappy', description: '', images: many },
      ],
    })
    expect(main.name).toBe('Cappy')
    expect(main.images).toHaveLength(3)
    expect(mainCharacter({ scenes: [scene(1)], characters: [] })).toBeNull()
  })
})

describe('Cutroom online’s address', () => {
  it('is the site part of what you type', () => {
    expect(siteOrigin('https://cutroom.example.com/projects/1?step=images')).toBe(
      'https://cutroom.example.com',
    )
    expect(siteOrigin('cutroom.example.com')).toBe('https://cutroom.example.com')
    expect(siteOrigin('http://192.168.1.20:3000')).toBe('http://192.168.1.20:3000')
    expect(siteOrigin('ftp://cutroom.example.com')).toBeNull()
    expect(siteOrigin('')).toBeNull()
  })
})

describe('the project open in Cutroom', () => {
  const tab = (tabId, projectId, at) => ({ tabId, origin: 'http://localhost:3000', projectId, at })

  it('is the one in the Cutroom tab you looked at last', () => {
    const tabs = { 3: tab(3, 'p1', 100), 5: tab(5, 'p2', 300), 7: tab(7, null, 500) }
    // Tab 7 is on another page (the Ideas, say): it has no project.
    expect(currentProject(tabs)).toEqual(tab(5, 'p2', 300))
    expect(currentProject({ 7: tab(7, null, 500) })).toBeNull()
    expect(currentProject(undefined)).toBeNull()
  })
})

describe('what the side panel offers for that project', () => {
  it('makes the pictures its scenes are missing', () => {
    expect(projectOffer({ hasScript: true, scenes: 24, missing: 18 })).toMatchObject({
      action: 'make',
      label: 'Make 18 pictures',
    })
    expect(projectOffer({ hasScript: true, scenes: 24, missing: 1 }).label).toBe('Make 1 picture')
  })

  it('splits a script into scenes with AI first, as only scenes have picture prompts', () => {
    expect(projectOffer({ hasScript: true, scenes: 0, missing: 0 })).toMatchObject({ action: 'split' })
  })

  it('asks for a script first, and only loads a project whose scenes all have a picture', () => {
    expect(projectOffer({ hasScript: false, scenes: 0, missing: 0 })).toMatchObject({ action: null })
    expect(projectOffer({ hasScript: true, scenes: 24, missing: 0 })).toMatchObject({ action: 'load' })
  })
})
