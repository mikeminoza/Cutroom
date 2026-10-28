import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseStoryboard, seconds } from '../lib/parse.js'
import {
  fileName,
  folderName,
  keywords,
  relatedIndex,
  shapePrompt,
  subject,
  wantsCharacter,
} from '../lib/prompt.js'

const storyboard = readFileSync(new URL('./fixtures/storyboard.txt', import.meta.url), 'utf8')

describe('reading a storyboard', () => {
  it('reads Cutroom’s storyboard: number, time, narration and the whole prompt', () => {
    const items = parseStoryboard(storyboard)
    expect(items.map((i) => i.number)).toEqual([1, 2, 3, 25, 36, 41, 50])
    expect(items[0].range).toEqual({ start: 0, end: 4.1, label: '0:00.0 – 0:04.1' })
    expect(items[3].range.start).toBeCloseTo(102.4)
    expect(items[0].narration).toBe('Look at you right now, scrolling in the dark like a sleepy goblin,')
    expect(items[0].prompt.split('\n')).toEqual([
      'A messy cartoon goblin hunched over under messy bed covers, staring blankly at a glowing bright smartphone screen in darkness.',
      'Shot: medium shot.',
      expect.stringMatching(/^Style: Crudely drawn MS Paint/),
      'Format: 16:9 widescreen. No text, captions, logos or watermarks in the image.',
    ])
  })

  it('reads the characters to attach, and the same text pasted with Windows line ends', () => {
    const text = storyboard.replace(
      'Narration: “Look at you',
      'Attach reference images for: Cappy, Bean\nNarration: “Look at you',
    )
    const [first] = parseStoryboard(text.replace(/\n/g, '\r\n'))
    expect(first.cast).toEqual(['Cappy', 'Bean'])
    expect(first.prompt).not.toContain('\r')
  })

  it('reads plain lists too: numbered lines, or one prompt per paragraph', () => {
    expect(
      parseStoryboard('1. A goblin in bed\n2. An alarm clock\n3) prompt about a sunrise').map((i) => [
        i.number,
        i.prompt,
      ]),
    ).toEqual([
      [1, 'A goblin in bed'],
      [2, 'An alarm clock'],
      [3, 'prompt about a sunrise'],
    ])
    expect(parseStoryboard('A cat on a mat.\n\nA dog in fog.').map((i) => [i.number, i.prompt])).toEqual([
      [1, 'A cat on a mat.'],
      [2, 'A dog in fog.'],
    ])
    expect(seconds('1:02:03.5')).toBeCloseTo(3723.5)
  })
})

describe('what goes to Flow', () => {
  const items = parseStoryboard(storyboard)
  const at = (number) => items.findIndex((i) => i.number === number)

  it('gives the character to scenes that show the protagonist, not other characters or objects', () => {
    const character = { name: 'Cappy' }
    const wants = (number) => wantsCharacter(items[at(number)], character)
    expect(wants(1)).toBe(true) // the "sleepy goblin" is you
    expect(wants(2)).toBe(true) // a stick figure
    expect(wants(3)).toBe(false) // a hand and an alarm clock
    expect(wants(36)).toBe(false) // a smug billionaire is someone else
    expect(wants(50)).toBe(false) // a brain character
    expect(wantsCharacter({ ...items[at(41)], cast: ['Cappy'] }, character)).toBe(true)
    expect(wantsCharacter(items[at(1)], null)).toBe(false)
  })

  it('matches a scene to the earlier one it shares the most with', () => {
    // Both smash the snooze button of a digital alarm clock.
    expect(relatedIndex(items, at(25))).toBe(at(3))
    expect(relatedIndex(items, at(2))).toBeNull()
    // Sharing only "alarm clock" is not enough.
    expect(relatedIndex(items, at(50))).toBeNull()
    expect(keywords(items[at(3)].prompt).has('alarm')).toBe(true)
    expect(subject(items[at(3)].prompt)).not.toMatch(/Style:/)
  })

  it('adds the character, the earlier scene and normal anatomy before the style, and tidies the prompt', () => {
    const prompt = shapePrompt(items[at(25)], {
      character: { name: 'Cappy', description: 'a stick figure in a grey hoodie.', pictured: true },
      withCharacter: true,
      related: { number: 3 },
      anatomy: true,
    })
    const lines = prompt.split('\n')
    expect(lines[0]).toMatch(/^Stick figure fist aggressively smashing/)
    expect(lines[2]).toBe(
      'Main character: Cappy (a stick figure in a grey hoodie). Any person in this picture is this character: draw them exactly like the reference picture, with the same face, body, proportions, colours and outfit.',
    )
    expect(lines[3]).toMatch(/^Continuity: this picture follows scene 3, attached\./)
    expect(lines[4]).toMatch(
      /^Anatomy: every person or character has one head, two arms, two hands with five fingers/,
    )
    expect(lines[5]).toMatch(/^Style: /)
    expect(prompt).toContain('character states.\n')
    expect(prompt).not.toContain('..')
    // The style asks for hand-lettered words, so "No text" would contradict it.
    expect(lines.at(-1)).toBe(
      'Format: 16:9 widescreen. No captions, logos or watermarks; any words in the picture are only the ones described above, spelled exactly.',
    )
    const plain = shapePrompt(
      {
        prompt:
          'A red ball.\nStyle: Watercolor.\nFormat: 16:9 widescreen. No text, captions, logos or watermarks in the image.',
        cast: [],
      },
      {},
    )
    expect(plain).toContain('No text, captions, logos or watermarks in the image.')
  })

  it('names the character by its Flow mention, and asks nothing of a picture without bodies', () => {
    const named = shapePrompt(items[at(2)], { character: { mention: '@Cappy' }, withCharacter: true })
    expect(named).toContain(
      'Main character: @Cappy. Any person in this picture is this character: draw them exactly like',
    )
    const plain = shapePrompt(items[at(41)], { anatomy: true })
    expect(plain).not.toContain('Anatomy:')
    expect(shapePrompt(items[at(3)], { anatomy: true })).toContain('Anatomy:')
    expect(shapePrompt(items[at(3)], { anatomy: false })).not.toContain('Anatomy:')
  })

  it('saves pictures under the scene number Cutroom’s Images step reads back', () => {
    expect(fileName(7)).toBe('scene-007.png')
    expect(fileName(7, 1, { extension: 'jpg' })).toBe('scene-007b.jpg')
    expect(fileName(123, 2)).toBe('scene-123c.png')
    // Cutroom matches a file to its scene by the last number in its name.
    const lastNumber = (name) => Number(name.match(/(\d{1,4})(?!.*\d)/)[1])
    expect(lastNumber(fileName(7, 1))).toBe(7)
    expect(folderName('why-you-wake-up-feeling-like-absolute-trash--storyboard (1).txt')).toBe(
      'why-you-wake-up-feeling-like-absolute-trash',
    )
    expect(folderName('')).toBe('storyboard')
  })
})
