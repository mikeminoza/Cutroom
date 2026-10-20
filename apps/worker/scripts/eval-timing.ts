// Measures caption word timing against ground truth. Windows' built-in speech engine (SAPI) reads
// a script and reports the true start of every word. The script then simulates the sentence times
// a transcription returns (each edge off by up to ±0.35 s) and compares:
//   estimate  words spread evenly over each sentence (the old behaviour)
//   pauses    sentence edges moved onto real pauses, words spread over speech only
//   one part  the AI voice-over path: the text is known, only the pauses place the words
//
//   pnpm --filter @cutroom/worker eval:timing        (Windows only)
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineTranscript, timeWords, wordsFromSegments } from '@cutroom/shared/align'
import type { TranscriptSegment, Word } from '@cutroom/shared/types'
import { detectSilences } from '../src/audio'
import { probeDuration } from '../src/render/ffmpeg'

const SCRIPT =
  'Octopuses have three hearts, and two of them stop when they swim. Their blood is blue, because it ' +
  'carries copper instead of iron. Each arm can taste, touch, and even make simple decisions on its own. ' +
  'Scientists once watched an octopus unscrew a jar from the inside! So, how smart are they, really? ' +
  'Let us find out.'

const outDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), 'tmp', 'eval-timing')

/** SAPI speech plus each word's true start. Positions are reported as if the audio were 16 kHz. */
function speak(wav: string, json: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'Register-ObjectEvent -InputObject $s -EventName SpeakProgress -SourceIdentifier sp | Out-Null',
    '$s.SetOutputToWaveFile($env:CUTROOM_WAV)',
    '$s.Speak($env:CUTROOM_TEXT)',
    '$s.SetOutputToNull()',
    '$w = @(Get-Event -SourceIdentifier sp | ForEach-Object { @{ text = $_.SourceEventArgs.Text; start = $_.SourceEventArgs.AudioPosition.TotalSeconds } })',
    '$s.Dispose()',
    'ConvertTo-Json -InputObject $w -Depth 3 | Set-Content -Path $env:CUTROOM_JSON -Encoding utf8',
  ].join('; ')
  return new Promise((done) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, CUTROOM_WAV: wav, CUTROOM_JSON: json, CUTROOM_TEXT: SCRIPT },
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => done(false))
    // PowerShell exits non-zero after event subscriptions even when it worked: check the output.
    child.on('close', () =>
      stat(json).then(
        (s) => done(s.size > 0),
        () => done(false),
      ),
    )
  })
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const wav = join(outDir, 'speech.wav')
  const json = join(outDir, 'truth.json')
  if (!(await speak(wav, json))) {
    console.log('This check needs Windows speech (SAPI). Skipped.')
    return
  }
  const scale = 16000 / 22050
  const truth = (
    JSON.parse((await readFile(json, 'utf8')).replace(/^﻿/, '')) as { text: string; start: number }[]
  )
    .filter((w) => /\w/.test(w.text))
    .map((w) => ({ text: w.text, start: w.start * scale }))
  const duration = await probeDuration(wav)
  const tokens = SCRIPT.split(/\s+/)
  if (tokens.length !== truth.length) {
    throw new Error(`SAPI reported ${truth.length} words for ${tokens.length} in the script.`)
  }

  let seed = 7
  const noise = () => {
    seed = (seed * 16807) % 2147483647
    return ((seed / 2147483647) * 2 - 1) * 0.35
  }
  const segments: TranscriptSegment[] = []
  let first = 0
  tokens.forEach((token, i) => {
    if (!/[.!?]$/.test(token)) return
    const end = Math.min(duration, (truth[i + 1]?.start ?? duration) - 0.15)
    segments.push({
      start: Math.max(0, truth[first].start + noise()),
      end: Math.min(duration, end + noise()),
      text: tokens.slice(first, i + 1).join(' '),
    })
    first = i + 1
  })

  const silences = await detectSilences(wav, duration)
  const report = (name: string, words: Word[]) => {
    const errors = words.map((w, i) => Math.abs(w.start - truth[i].start))
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    const within = errors.filter((e) => e <= 0.15).length / errors.length
    console.log(
      `${name.padEnd(9)} mean error ${String(Math.round(mean * 1000)).padStart(4)} ms, ${Math.round(within * 100)}% of words within 150 ms`,
    )
  }
  console.log(`${truth.length} words, ${silences.length} pauses found, ${duration.toFixed(2)} s`)
  report('estimate', wordsFromSegments(segments))
  report('pauses', refineTranscript(segments, silences, duration).words)
  report('one part', timeWords(tokens.join(' '), { start: 0, end: duration }, silences))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
