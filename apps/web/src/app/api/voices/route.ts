import { elevenLabsVoices, hasElevenLabsKey } from '@cutroom/shared/elevenlabs'
import { GEMINI_VOICES } from '@cutroom/shared/types'
import { route } from '@/server/http'

/** Voices to pick from: Gemini's prebuilt ones, and your ElevenLabs voices when it is set up. */
export const GET = route(async () => {
  const gemini = GEMINI_VOICES.map((v) => ({ id: v.name, name: v.name, description: v.character }))
  if (!hasElevenLabsKey()) return { gemini, elevenlabs: [], elevenlabsError: null }
  try {
    return { gemini, elevenlabs: await elevenLabsVoices(), elevenlabsError: null }
  } catch (error) {
    return { gemini, elevenlabs: [], elevenlabsError: error instanceof Error ? error.message : String(error) }
  }
})
