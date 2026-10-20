'use client'

// Cuts a stretch out of a stored voice-over in the browser, as a mono WAV file (used to make a
// Short from a long video: the server has no ffmpeg). Long recordings are decoded at a lower
// sample rate so the decoded audio stays a reasonable size in memory.

function wavFile(samples: Float32Array, sampleRate: number, name: string): File {
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  const bytes = samples.length * 2
  text(0, 'RIFF')
  view.setUint32(4, 36 + bytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, bytes, true)
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return new File([header, pcm.buffer], name, { type: 'audio/wav' })
}

/** Seconds `start`..`end` of the audio at `url`, mixed down to mono. */
export async function cutAudio(
  url: string,
  start: number,
  end: number,
  totalSeconds: number,
  name = 'voiceover.wav',
): Promise<File> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load the voice-over (HTTP ${response.status}).`)
  const encoded = await response.arrayBuffer()
  // 44.1 kHz for up to 15 minutes, 24 kHz (still clear for speech) beyond.
  const sampleRate = totalSeconds > 15 * 60 ? 24_000 : 44_100
  const context = new OfflineAudioContext(1, 1, sampleRate)
  const audio = await context.decodeAudioData(encoded)
  const from = Math.max(0, Math.floor(start * audio.sampleRate))
  const to = Math.min(audio.length, Math.ceil(end * audio.sampleRate))
  if (to <= from) throw new Error('That part of the voice-over is empty.')
  const mono = new Float32Array(to - from)
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel)
    for (let i = 0; i < mono.length; i++) mono[i] += data[from + i] / audio.numberOfChannels
  }
  return wavFile(mono, audio.sampleRate, name)
}
