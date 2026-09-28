// Builds the two microphone inputs the noise-suppression probe feeds the app
// through Chromium's fake audio capture: one of pure noise, one of real
// speech with the same noise mixed under it.
//
// 48 kHz, 16-bit PCM, mono — what --use-file-for-fake-audio-capture accepts.
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const RATE = 48000
const out = join(fileURLToPath(new URL('..', import.meta.url)), '.probe', 'audio')
mkdirSync(out, { recursive: true })

const writeWav = (path, samples) => {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2))
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8)
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write('data', 36); head.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([head, data]))
  return path
}

/** Broadband hiss: the kind of steady noise any suppressor should remove. */
const noise = (seconds, level = 0.12) =>
  Float64Array.from({ length: RATE * seconds }, () => (Math.random() * 2 - 1) * level)

// Real speech, because a model trained on voices must be judged on one.
// Windows' own synthesiser writes the wav; nothing is downloaded.
const speechWav = join(out, 'speech-raw.wav')
if (!existsSync(speechWav)) {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `
    Add-Type -AssemblyName System.Speech
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $s.SetOutputToWaveFile('${speechWav.replace(/\\/g, '/')}')
    $s.Rate = -1
    $s.Speak('The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How razorback jumping frogs can level six piqued gymnasts.')
    $s.Dispose()
  `], { stdio: 'inherit' })
}

/** Read a 16-bit PCM wav back as floats, resampling by nearest sample. */
const readWav = (path) => {
  const buf = readFileSync(path)
  let pos = 12, rate = RATE, channels = 1, dataAt = -1, dataLen = 0
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') { channels = buf.readUInt16LE(pos + 10); rate = buf.readUInt32LE(pos + 12) }
    if (id === 'data') { dataAt = pos + 8; dataLen = size; break }
    pos += 8 + size + (size % 2)
  }
  if (dataAt < 0) throw new Error(`no data chunk in ${path}`)
  const count = Math.floor(dataLen / 2)
  const src = new Float64Array(Math.floor(count / channels))
  for (let i = 0; i < src.length; i++) src[i] = buf.readInt16LE(dataAt + i * channels * 2) / 32768
  if (rate === RATE) return src
  const ratio = RATE / rate
  return Float64Array.from({ length: Math.floor(src.length * ratio) }, (_, i) => src[Math.floor(i / ratio)])
}

const speech = readWav(speechWav)
const SECONDS = Math.max(8, Math.ceil(speech.length / RATE) + 2)

// 1. Noise alone. A suppressor that works should nearly erase this.
writeWav(join(out, 'noise-only.wav'), noise(SECONDS))

// 2. The same noise with speech over it. A suppressor that works should keep
//    the speech and quieten the gaps between the words.
const mixed = noise(SECONDS)
const lead = RATE  // a second of noise alone at the front, to measure against
for (let i = 0; i < speech.length && lead + i < mixed.length; i++) mixed[lead + i] += speech[i] * 0.8
writeWav(join(out, 'speech-plus-noise.wav'), mixed)

// 3. The hard case: a quieter voice under heavier noise.
//
//    A synthesised voice is the easiest input a speech model will ever see —
//    loud, clean, perfectly articulated, no breath, no room. Passing on that
//    says little about a real person on a real microphone. This is the closest
//    a synthetic test gets to the hard case, and it is where over-suppression
//    should show up if it is going to.
const quiet = noise(SECONDS, 0.18)
for (let i = 0; i < speech.length && lead + i < quiet.length; i++) quiet[lead + i] += speech[i] * 0.3
writeWav(join(out, 'quiet-speech.wav'), quiet)

console.log(`wrote ${SECONDS}s of noise-only.wav, speech-plus-noise.wav and quiet-speech.wav to ${out}`)
console.log(`speech is ${(speech.length / RATE).toFixed(1)}s, starting at 1.0s`)
