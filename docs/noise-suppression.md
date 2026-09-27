# Noise suppression

Four modes, in order of how hard they work:

| Mode | What it is | Cost |
|---|---|---|
| None | The microphone untouched | — |
| Standard | The browser's own filter | Free |
| RNNoise | Band-gain model, strongest on steady sound: fans, hum | Small |
| DeepFilterNet 3 | A real model, strongest on clatter, keyboards, rooms | ~10 MB one-off download, more CPU, ~40 ms latency |

All four solve **noise**. None of them is speaker separation: another person
talking near you is a voice, and every one of these is built to keep voices.

## How it is wired

`micChain.ts` builds one WebAudio graph for the microphone — gain, the chosen
noise node, then the voice-activity gate — and hands it to LiveKit as a track
processor (`mic.setProcessor`). Switching between RNNoise, DeepFilterNet and
neither changes the shape of the graph, so that rebuilds; moving a slider only
updates parameters in place, which avoids a gap in the outgoing audio.

DeepFilterNet's weights are baked into a multi-megabyte wasm, so
`deepFilterProcessor.ts` is only ever reached through a dynamic `import()`
gated on the mode being selected. A static import would put that download on
every session, including everyone who never turns it on.

If a model fails to load, the chain falls back to the browser filter and says
so. A call nobody can hear you in is the one outcome worse than losing the
fancy filter.

## Attenuation is 24 dB, not 100

The package defaults to 100 dB, which is not suppression but erasure —
measured here, a signal it judged non-speech came back as exact digital
silence. The model decides what a voice is, and it will sometimes be wrong: a
quiet microphone, a heavy accent, a cheap headset, someone speaking through a
fan. At 100 dB that person simply does not exist on the call and cannot tell
why. At 24 dB they are faint and audible.

## Measured

`desktop/scripts/noise-suppression-probe.mjs` runs the packaged app with
Chromium's fake microphone fed from a known wav, joins a call, and measures
what reaches the wire. `scripts/make-test-audio.mjs` builds the inputs: white
noise, and the same noise under twelve seconds of real speech from the Windows
synthesiser.

DeepFilterNet against no filter, same input, 2026-09-28:

| Input | Off | DeepFilterNet | Change |
|---|---|---|---|
| Noise only | 0.06935 | 0.00439 | **−24.0 dB** |
| Speech + noise, the gaps | 0.06885 | 0.00433 | **−24.0 dB** |
| Speech + noise, **the speech** | 0.14175 | 0.09581 | **−3.4 dB** |

−24.0 dB is exactly the configured attenuation limit. The noise floor drops by
the full amount while speech drops 3.4 dB, so the signal-to-noise ratio
improves by about **21 dB**. That difference is the whole point: a filter that
merely muted would take both down together.

### Two traps in measuring this

- **Measure the track that is sent, not the one that was added.** LiveKit
  applies a processor by building a new track and swapping it in with
  `replaceTrack`. The track handed to `addTrack` is the raw capture, and
  measuring it reports 0.0 dB for every mode — which is what happened first
  and briefly looked like a broken model.
- **Turn the voice-activity gate off.** With sensitivity above zero the gate
  closes over the quiet parts on its own, and the suppressor gets the credit.

### Why the probe keeps one warm profile

It signs in once and reuses the session. The API rate-limits logins to a few
per fifteen minutes, so a cold profile per mode locks the account out halfway
through a comparison.
