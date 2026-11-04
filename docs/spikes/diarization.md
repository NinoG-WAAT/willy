# Spike: local speaker diarization (issue #104)

Status: spike result, no production code. Date of the measurements: 2026-11-04. Machine: Apple M1 Pro (10 cores), 16 GB, macOS 26.6, Node 26.1.0, ffmpeg and whisper-cli from Homebrew.

## 0. Answer

**Recommendation: go with conditions.** sherpa-onnx offline diarization (pyannote segmentation 3.0 + a speaker-embedding model, both ONNX, no Python, no token) installs from prebuilt downloads in a few minutes, runs as a spawned binary exactly like whisper.cpp, and on synthetic French audio told 2 to 4 voices apart well enough to be useful: **speaker error 2 to 11 % of speech time with 2 or 3 voices, 9 to 22 % with 4 voices, including laptop-microphone-like signals** (section 6.2), and it labelled **87 to 98 % of real whisper segments with the right speaker** (section 6.8). Speed is not a problem: **about 90 s for 18 minutes** (real-time factor 0.085, section 6.1), about 440 MB of memory.

The conditions, because the evidence is synthetic and has real gaps:

1. **The owner runs section 11 on a real recording of two or three people BEFORE any production PR.** Synthetic `say` voices prove the plumbing and a floor of accuracy, not accuracy on human voices (section 1). If that test shows the labels are mostly right, build it; if not, stop here, nothing was built.
2. **Ship it off by default** (`DIARIZATION_PROVIDER=none`), Node/self-hosted only, models supplied by the owner from configuration (never bundled).
3. **Settle the embedding-model licence.** The best-measured model, 3D-Speaker ERes2Net base, has no licence statement in its release; the Apache-2.0 CAM++ model performed about the same (section 6.3). Pick after the licence question, not before.
4. **Accept the retention change** (section 9.2): raw audio can no longer be deleted chunk by chunk right after transcription; it is deleted once per meeting after speaker detection (minutes later). This changes the consent and README wording and needs the owner's explicit yes.
5. Labels are **anonymous and approximate** ("Speaker A/B"), owner rename/merge stays the source of truth, a failure always falls back to "Speaker 1" and never fails the meeting.

No-go signals to watch in the real-voice test: two people with similar voices merged into one label for more than a third of their speech (it happened with two synthetic male voices, section 7), or more than about one wrong label in five segments with only two speakers.

Everything below is reproducible with the scripts in `scripts/spikes/diarization/` (section 13).

## 1. Question, method, and what synthetic voices do and do not prove

Question: can the app tell several people apart locally (no cloud, no Hugging Face token, no Python), well enough to be useful, given that it records 10-second browser chunks (webm/opus), transcribes each chunk independently with whisper.cpp in French, and labels every line "Speaker 1" today?

Method: install the engine, generate test conversations with a known timeline, run it, score it against the known timeline, then map the result onto real whisper segments.

**Test audio is synthetic.** macOS `say` French voices (Thomas, Amélie, Jacques, Grandma) read invented meeting sentences, with turn lengths from one word ("Oui.") to three sentences, a dominant speaker and a quiet one (shares 40/30/20/10 % for four voices), gaps of 0.15 to 0.9 s and, in some files, silences of 4 to 14 s and deliberate overlaps (a turn starting 0.4 to 1.3 s before the previous one ends, and short interjections inside long turns). No real meeting, recording or person was used.

What it proves:

- the whole pipeline works end to end on this machine (install, binary, models, output, scoring, mapping onto whisper segments, the production audio path of webm/opus chunks rebuilt into one file);
- speed, memory and failure behaviour, which do not depend on who is talking;
- a floor: a diarizer that cannot separate clean TTS voices would be useless on people.

What it does NOT prove:

- **accuracy on human voices.** Synthetic voices are perfectly steady (no emotion, no leaning towards the microphone, no coughs or laughter, no talking over each other with natural prosody), and each speaker is a different engine, so voices may be more, or occasionally less (two male voices were confused, section 7), distinct than two colleagues. The "laptop microphone" files are only a filter chain (band limit 150 Hz to 5.5 kHz, -14 dB, small-room echo, pink noise about 13 dB below speech, per-speaker level offsets of 0 to -11 dB); a real laptop mic adds fan noise, keyboard noise and speakers at different distances.
- accuracy for accents, languages other than French, or more than 4 voices (not tried).

Treat every accuracy number as a plausible floor of what works, not a forecast. The real-voice test in section 11 is the deciding evidence.
## 2. Install on Apple Silicon macOS (exact steps)

Everything is a plain download of a prebuilt release: no Python, no Hugging Face account or token, no build, no sudo, no global package. Use a NEW, EMPTY directory outside the repository (below `~/willy-diarization`; any path works). Downloads are untrusted data: they are only extracted into their own folders and are never run from inside those folders (every path is passed as an absolute argument).

```bash
SPIKE="$HOME/willy-diarization"          # must not exist yet
mkdir "$SPIKE" && cd "$SPIKE" && mkdir dl bin models
BASE=https://github.com/k2-fsa/sherpa-onnx/releases/download

# 1. The binary (sherpa-onnx v2.0.1, released 2026-10-26, osx-arm64, shared libraries, no TTS: 17.8 MB)
curl -fL -o dl/sherpa.tar.bz2 "$BASE/v2.0.1/sherpa-onnx-v2.0.1-osx-arm64-shared-no-tts.tar.bz2"
echo "4fcc6c77c8d8d2e2f04cfdc17c6fd224c01469b78529370eb9d8e0e5ec97ac79  dl/sherpa.tar.bz2" | shasum -a 256 -c -
tar -xjf dl/sherpa.tar.bz2 -C bin

# 2. Segmentation model: pyannote segmentation 3.0 as ONNX (6.9 MB archive)
curl -fL -o dl/seg.tar.bz2 "$BASE/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
shasum -a 256 dl/seg.tar.bz2     # compare with the line in section 3 (the release publishes no checksum)
mkdir models/pyannote && tar -xjf dl/seg.tar.bz2 -C models/pyannote

# 3. Speaker embedding model (39.6 MB). 3D-Speaker ERes2Net base is the one used for the measurements, see section 6.3.
curl -fL -o models/eres2net.onnx "$BASE/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
shasum -a 256 models/eres2net.onnx
```

Notes:

- The binary archive checksum comes from the GitHub release metadata (`gh api repos/k2-fsa/sherpa-onnx/releases/latest`, field `digest`) and matched. The model releases publish **no** checksums (`digest: null`); the values in section 3 are what this spike downloaded (trust on first use). Pin them in the setup script once the owner accepts the models.
- `curl` does not set the macOS quarantine flag. A browser download does, and Gatekeeper then refuses the unsigned binary; run `xattr -d com.apple.quarantine <file>` on the extracted files or just use `curl`.
- The program is `bin/sherpa-onnx-v2.0.1-osx-arm64-shared-no-tts/bin/sherpa-onnx-offline-speaker-diarization` (0.4 MB) and needs the sibling `lib/` folder (onnxruntime 1.28.2, 29 MB); keep the folder layout. Installed footprint: about 60 MB for the binary folder plus 48 MB of models.
- The Python wheels, Node addon and Swift package of sherpa-onnx wrap the same engine. The spawned binary was chosen because it needs nothing but files and matches how whisper.cpp is used (`docs/PLAN.md`, Local Whisper adapter).

## 3. Licences, sizes and checksums

| Part | Source | Size | Licence | Work or commercial use |
|---|---|---|---|---|
| sherpa-onnx binary and libraries | k2-fsa/sherpa-onnx v2.0.1 | 17.8 MB download | Apache-2.0 (repository licence, checked with the GitHub API) | Yes |
| onnxruntime 1.28.2 (inside the archive) | Microsoft | 29 MB | MIT (well known; not re-verified from the archive) | Yes |
| pyannote segmentation 3.0 (ONNX export by k2-fsa) | `sherpa-onnx-pyannote-segmentation-3-0.tar.bz2` | 6.9 MB (`model.onnx` 6.0 MB, `model.int8.onnx` 1.5 MB) | MIT, `LICENSE` file inside the archive ("Copyright (c) 2022 CNRS"); model card on Hugging Face also says `mit` | The MIT text allows it. The model card does not discuss the training data (AISHELL, AliMeeting, AMI, AVA-AVD, DIHARD, Ego4D, MSDWild, REPERE, VoxConverse), whose own terms are not restated by it |
| 3D-Speaker ERes2Net base (zh-cn) | `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` | 39.6 MB | **Not stated** in the release or the ONNX file. The 3D-Speaker toolkit is Apache-2.0; its README says only that models are "accessible on ModelScope". The ModelScope model card was not checked (not reachable as plain text) | Unconfirmed: check the ModelScope card before relying on it |
| 3D-Speaker CAM++ (zh-en advanced) | `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` | 28.3 MB | A Hugging Face mirror of the CAM++ zh-cn model lists Apache-2.0 | Probably yes, confirm |
| WeSpeaker ResNet34-LM / CAM++ (VoxCeleb) | `wespeaker_en_voxceleb_resnet34_LM.onnx`, `wespeaker_en_voxceleb_CAM++.onnx` | 26.5 / 29.3 MB | WeSpeaker says pretrained models follow the licence of their training data; the pyannote-hosted ResNet34-LM card says CC-BY-4.0 (VoxCeleb) | CC-BY-4.0 allows commercial use with attribution; the VoxCeleb audio origin is a separate legal question |
| NeMo TitaNet small | `nemo_en_titanet_small.onnx` | 40.3 MB | CC-BY-4.0 (NVIDIA model card of the large model; the small one was assumed to match) | CC-BY-4.0, attribution required |
| Rev.ai Reverb diarization v1/v2 (not used) | k2-fsa release | 10.9 MB / 254 MB | The sherpa-onnx docs warn of a **non-commercial** licence | **No**: do not use |

This is a reading of public pages, not legal advice. For a personal/founder tool the practical risk is low; if Willycrumbs is ever distributed or sold, the embedding model licence (and the training data behind the segmentation model) must be settled first. The adapter must therefore take the model paths from configuration and bundle nothing.

SHA-256 of what was downloaded:

| File | SHA-256 |
|---|---|
| `sherpa-onnx-v2.0.1-osx-arm64-shared-no-tts.tar.bz2` | `4fcc6c77c8d8d2e2f04cfdc17c6fd224c01469b78529370eb9d8e0e5ec97ac79` (published, verified) |
| `sherpa-onnx-pyannote-segmentation-3-0.tar.bz2` | `24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488` |
| `model.onnx` (inside it) | `220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079` |
| `model.int8.onnx` (inside it) | `d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d` |
| `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` | `1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b` |
| `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx` | `c59158379255ad66e161679cca6af8d52d51e389e3224ab7d7a7baae295c2db5` |
| `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` | `aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2` |
| `wespeaker_en_voxceleb_CAM++.onnx` | `c46fad10b5f81e1aa4a60c162714208577093655076c5450f8c469e522ec54ef` |
| `wespeaker_en_voxceleb_resnet34_LM.onnx` | `e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012` |
| `nemo_en_titanet_small.onnx` | `ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e` |
## 4. Working command lines and output

The measured, recommended invocation (paths from section 2; `WAV` is 16 kHz mono 16-bit):

```bash
BIN="$SPIKE/bin/sherpa-onnx-v2.0.1-osx-arm64-shared-no-tts/bin/sherpa-onnx-offline-speaker-diarization"
"$BIN" \
  --clustering.cluster-threshold=0.7 \
  --segmentation.pyannote-model="$SPIKE/models/pyannote/sherpa-onnx-pyannote-segmentation-3-0/model.onnx" \
  --embedding.model="$SPIKE/models/eres2net.onnx" \
  --segmentation.pyannote-window-shift-ratio=0.25 \
  --segmentation.num-threads=4 --embedding.num-threads=4 \
  "$WAV" > turns.txt
```

A ready wrapper (`scripts/spikes/diarization/run-diarization.sh`, environment variables `SHERPA_BIN`, `SEG_MODEL`, `EMB_MODEL`) does the same, prints time and peak memory, and nothing leaves the machine. Convert any recording first: `ffmpeg -i in.m4a -ar 16000 -ac 1 -c:a pcm_s16le out.wav`. The binary refuses other sample rates (exit 255, "Expect sample rate 16000"), so the real adapter must always hand it the WAV it built itself.

Output. stdout carries the turns, one per line, seconds from the start of the file, plus a config echo and `Started` that a parser must ignore; stderr carries progress, the duration and the real-time factor:

```
0.368 -- 14.223 speaker_00
14.392 -- 18.728 speaker_01
19.353 -- 19.977 speaker_00
```

Turns of different speakers can overlap in time (the segmentation model is overlap-aware). Cluster ids (`speaker_NN`) are arbitrary and not ordered by appearance. Exit code 0 on success, including "no speech found" (no turns); 255 on any error.

Options that matter (from `--help`):

| Option | Default | What was found |
|---|---|---|
| `--clustering.cluster-threshold` | 0.5 | Too low for this use: it split 3 voices into 8 and 4 voices into 11 (2 voices into 4 with the binary's default window shift). 0.7 to 0.8 worked (section 6.3). 0.9 collapses to 1 to 3 speakers. Model-specific. |
| `--clustering.num-clusters` | -1 (off) | Forcing the count was worse than the threshold (section 6.6). Do not use. |
| `--segmentation.pyannote-window-shift-ratio` | 0.1 | The main speed knob: 0.1 / 0.25 / 0.5 took 371 / 92 / 65 s for 18 minutes (section 6.4). |
| `--segmentation.num-threads`, `--embedding.num-threads` | 1 | 2 to 4 is enough; 8 gave nothing more. |
| `--min-duration-on` / `--min-duration-off` | 0.3 / 0.5 | Turns shorter than 0.3 s are dropped; gaps shorter than 0.5 s inside one speaker are filled (this alone costs about 5 s of "false alarm" per 4 minutes, see section 5). |
| `--embedding.provider`, `--segmentation.provider` | cpu | `coreml` exists; not tried (CPU is fast enough). |

## 5. Test material

All generated by `scripts/spikes/diarization/make-synthetic.mjs` (seeded, repeatable) and `degrade.sh`; voices: Thomas, Amélie, Jacques, Grandma (fr_FR / fr_CA). Ground truth is the exact synthesis timeline, trimmed of the silence TTS adds at both ends.

| File | Voices | Length | Utterances | Notes |
|---|---|---|---|---|
| clean-2, clean-3, clean-4 | 2, 3, 4 | 242 to 248 s | 36 to 40 | clean, 8 to 10 turns shorter than 2 s |
| mic-2, mic-3, mic-4 | 2, 3, 4 | same timelines | same | "laptop microphone": per-speaker level 0 / -4 / -8 / -11 dB, band-limit, -14 dB, echo, noise; mean level -39.5 dB, peak -21.6 dB |
| ovl-2 | 2 | 241 s | 46 | clean, overlaps (about 30 % of turns start early, interjections inside long turns), 17 short turns |
| ovl-3-mic | 3 | 245 s | 58 | overlaps plus the laptop-mic chain, 29 short turns |
| pause-3-mic | 3 | 245 s | 33 | silences of 4 to 14 s, only 188 s of speech |
| X-opus (clean-4, mic-3, mic-4, ovl-3-mic) | as source | as source | | the production path: 10 s webm/opus chunks (48 kHz, 32 kbps, 25 chunks, about 1 MB), each decoded to 16 kHz mono, padded to its declared 10 s, joined |
| solo-1-mic | 1 | 254 s | 44 | one person with pauses (a founder dictating) |
| short-2-mic | 2 | 31 s | 3 | a very short meeting |
| long-4 | 4 | 1082 s (18 min) | 182 | speed and memory; a 60 minute file made by repeating it, speed and memory only |
| noise-only | 0 | 60 s | 0 | pink noise, no speech |
| bad-* | | | | 44.1 kHz stereo, truncated, empty, text file renamed .wav |

Scoring (`score-diarization.mjs`): frame-level (10 ms) diarization error rate with several simultaneous speakers per frame and the best one-to-one mapping of engine speakers to true speakers: DER = (missed speech + false alarm + speaker confusion) / true speech. Two numbers per row: **DER with no collar**, and **DER with a 0.25 s collar** around every true turn boundary (the standard way to ignore boundary jitter). The no-collar figure includes about 5 to 9 s per 4-minute file of "false alarm" that is the engine filling pauses of up to 0.5 s between turns (in the 2-voice file its false alarm, 4.9 s, matches the 5.4 s of gaps shorter than 0.5 s in the timeline); the collar figure is the better measure of "was the right person named".

## 6. Results

### 6.1 Speed and memory

Measured with `/usr/bin/time -l` and the binary's own real-time factor (RTF = processing time / audio time). **The machine was not idle**: other processes kept the load average between 5 and 10 on the 10 cores during all runs (one early run saw 25), so these numbers are probably pessimistic, not optimistic.

| Audio | Window shift | Threads | Time | RTF | Peak memory |
|---|---|---|---|---|---|
| 4 min | 0.25 (recommended) | 4 | 20 s | 0.08 | 365 MB |
| 18 min | 0.1 (binary default) | 4 | 371 s | 0.34 | 390 MB |
| 18 min | **0.25 (recommended)** | 4 | **92 s** | **0.085** | 441 MB |
| 18 min | 0.5 | 1 / 2 / 4 / 8 | 101 / 67 / 65 / 63 s | 0.09 / 0.06 / 0.06 / 0.06 | 426 to 441 MB |
| 60 min (the 18 min file repeated) | 0.5 | 4 | 140 s | 0.039 | 847 MB |
| 60 s of noise, no speech | 0.5 | 1 | 0.6 s | 0.01 | n/a |

Memory grows about 10 MB per minute of audio (365 MB at 4 minutes, 441 MB at 18, 847 MB at 60): 2 hours would be about 1.5 GB (extrapolated, not measured; the longest measured file is 60 minutes). Whisper base on the same machine took 15 to 20 s for 25 chunks of 10 s including process start (about 0.7 s per chunk), so for an 18 minute meeting diarization (92 s) costs about as much as transcription (about 75 s).

### 6.2 Accuracy per file and condition

Recommended configuration: ERes2Net base (3D-Speaker), `cluster-threshold 0.7`, window shift 0.25, then `consolidateSpeakers` (section 8, rule 6). "Found raw / consolidated" is the number of speakers the engine returned before and after dropping micro-speakers. "DER / collar" are percentages. The last column repeats the consolidated result with window shift 0.5 for comparison.

| Condition | True speakers | Found raw / cons. | Engine alone, DER / collar | **Consolidated, DER / collar** | Same at shift 0.5 | DER on overlapped frames | Short turns (<2 s) right | RTF | Memory MB |
|---|---|---|---|---|---|---|---|---|---|
| 2 voices, clean | 2 | 2 / 2 | 2 / 0 | **2 / 0** | 2.2 / 0 | - | 9/9 | 0.083 | 365 |
| 3 voices, clean | 3 | 3 / 3 | 6.1 / 2.5 | **6.1 / 2.5** | 7.8 / 4 | - | 8/10 | 0.085 | 363 |
| 4 voices, clean | 4 | 4 / 4 | 9.2 / 4.8 | **9.2 / 4.8** | 13.3 / 8.3 | - | 3/8 | 0.085 | 359 |
| 2 voices, laptop-mic | 2 | 2 / 2 | 3 / 0.1 | **3 / 0.1** | 3.3 / 0.1 | - | 9/9 | 0.084 | 364 |
| 3 voices, laptop-mic | 3 | 4 / 3 | 4.8 / 0.7 | **5.1 / 0.7** | 6.2 / 1.9 | - | 7/10 | 0.084 | 306 |
| 4 voices, laptop-mic | 4 | 8 / 5 | 23 / 17.3 | **22 / 16.5** | 16.3 / 10 | - | 1/8 | 0.077 | 377 |
| 2 voices, overlaps, clean | 2 | 3 / 2 | 3.6 / 0.2 | **3.3 / 0.2** | 3.4 / 0 | 11.2 % | 13/17 | 0.078 | 367 |
| 3 voices, overlaps, laptop-mic | 3 | 5 / 3 | 11.4 / 3.7 | **11.4 / 3.8** | 10 / 3.3 | 28 % | 15/29 | 0.074 | 383 |
| 3 voices, long pauses, laptop-mic | 3 | 5 / 3 | 6.7 / 1.8 | **6.6 / 1.8** | 7.1 / 1.9 | - | 3/9 | 0.073 | 346 |
| 4 voices, clean, via 10 s webm/opus chunks | 4 | 4 / 4 | 9.7 / 5.2 | **9.7 / 5.2** | 15.3 / 10.1 | - | 3/8 | 0.083 | 353 |
| 3 voices, laptop-mic, via chunks | 3 | 5 / 3 | 5.9 / 1.5 | **5.4 / 0.9** | 6.7 / 2 | - | 6/10 | 0.086 | 361 |
| 4 voices, laptop-mic, via chunks | 4 | 7 / 4 | 10.9 / 5.2 | **10.5 / 5.1** | 13.4 / 7.9 | - | 2/8 | 0.078 | 380 |
| 3 voices, overlaps, laptop-mic, via chunks | 3 | 6 / 3 | 12.7 / 4.9 | **11.6 / 4.5** | 10.3 / 3.1 | 26.2 % | 13/29 | 0.085 | 376 |
| 1 voice, pauses, laptop-mic | 1 | 1 / 1 | 9.4 / 1.2 | **9.4 / 1.2** | 10 / 1.5 | - | 19/19 | 0.065 | 347 |
| 2 voices, 31 s only, laptop-mic | 2 | 2 / 2 | 1.7 / 0 | **1.7 / 0** | 47.8 / 46.7 | - | 1/1 | 0.064 | 328 |

Reading it:

- **2 voices: essentially solved** (collar DER 0 to 0.2 %), clean or degraded, with overlaps or not. **3 voices: 5 to 11 %** (collar 0.7 to 3.8 %). **4 voices: 9 to 22 %**, and the 22 % is one run with a quiet, noisy fourth voice (section 7); the same file through the chunk path gave 10.5 %.
- **Consolidation turns "too many speakers" into the right number** in 14 of 15 files (raw 8 became 5, 7 became 4, 6 became 3, 5 became 3; only the noisy 4-voice file stayed at 5 instead of 4). It changed the error rate little, because the extra speakers are tiny: its job is to make the labels usable (one "Speaker D" for a cough is noise for the reader), not to fix confusion between two real voices.
- **The solo file is the safe case**: one speaker stayed one speaker at every threshold from 0.5 to 0.9 (the 9.4 % is the pause-filling, collar DER 1.2 %).
- **The webm/opus chunk path does not hurt.** Rebuilding the file from 10 s webm/opus chunks (padded to 10.000 s each) gave 9.7 vs 9.2 (clean-4), 5.4 vs 5.1 (mic-3), 10.5 vs 22 (mic-4: the clustering outcome on the hard file moves by more than any chunk effect) and 11.6 vs 11.4 (ovl-3-mic). Without the padding the rebuilt file is shorter by 5.8 ms per chunk (144 ms over 25 chunks, 0.6 s over 18 minutes), which would shift every later label against the transcript timeline.
- **Noise in the measurement**: the same timeline moved by up to 6 points between the two window shifts (4 voices, laptop-mic: 23 vs 16.7) and by 12 points between the plain and the chunked version (22 vs 10.5). With 15 files and one run each, differences under about 5 DER points between configurations are not significant. The whole table says "works, 5 to 15 % typical", not "11.4 beats 11.6".

### 6.3 Embedding model and threshold

The embedding model decides how voices are told apart. Six models from the sherpa-onnx releases were swept over five hard files (mic-2, mic-3, mic-4 via chunks, ovl-3-mic via chunks, pause-3-mic) at thresholds 0.5 to 0.9, engine alone, ratio 0.5. Mean DER (no collar / collar) over the five files at the best threshold:

| Embedding model | Best threshold | Mean DER / collar | At 0.9 | Notes |
|---|---|---|---|---|
| 3D-Speaker ERes2Net base (zh-cn) | 0.7 to 0.8 | 8.4 / 3.2 and 8.3 / 3.1 | 33 % (collapse) | **used above**; trained on Chinese, fine on French TTS; 39.6 MB; licence unstated |
| 3D-Speaker ERes2Net (en, VoxCeleb) | 0.7 | 8.2 / 2.9 | 11.9 | same quality, 26.5 MB |
| 3D-Speaker CAM++ (zh-en advanced) | 0.6 to 0.7 | 8.8 / 3.5 | 29.9 % | breaks at 0.8 on one file (39.9 %); 28.3 MB; Apache-2.0 likely |
| NeMo TitaNet small (en) | 0.6 | 11.8 / 6.1 | 24.7 % | clearly worse on the 4-voice file |
| WeSpeaker ResNet34-LM (en) | 0.5 | 10.9 / 5.8 | 62 % | only works at or below 0.5, merges everything above; lower thresholds not tried |
| WeSpeaker CAM++ (en) | none | 56 to 61 % at every threshold | 59.9 | unusable here as shipped; not investigated |

ERes2Net (either) and CAM++ are equivalent within the noise of this test. The practical lesson is about the threshold: **the good window is narrow and model-specific** (0.6 to 0.8 for these three, a cliff at 0.9, and the binary's default of 0.5 over-splits). The threshold must therefore be configuration, validated with the owner's real voices (section 11), and consolidation must follow it.

### 6.4 Window shift and the int8 segmentation model

| Setting (ERes2Net, threshold 0.8, engine alone) | mic-3 via chunks | mic-4 via chunks | ovl-3-mic via chunks | 18 min file | Time for 18 min |
|---|---|---|---|---|---|
| shift 0.1 (binary default) | 7.0 | 8.0 | 15.3 | 7.7 / 3.3 | 371 s |
| shift 0.25 | 4.8 | 10.1 | 14.7 | 9.4 / 4.5 | 92 s |
| shift 0.5 | 5.9 | 13.7 | 11.2 | 12.5 / 6.9 | 65 s |

(DER, then "DER / collar" for the 18 minute file.) There is a mild gain from a smaller shift on long, clean material and none on the short hard files, for 4 to 6 times the time. **0.25 is the compromise**; 0.5 is acceptable if speed ever matters. The `model.int8.onnx` segmentation model (1.5 MB instead of 6 MB) was faster (43 s) but clearly worse (18 min: 14.4 / 8.6 %; mic-4: 33 %): not recommended.

### 6.5 Chunk path

Covered in 6.2: no measurable harm from the 10 s webm/opus path once each chunk is padded to its declared duration. Whisper itself was run on the same chunks (section 6.8).

### 6.6 The owner gives the number of speakers: forced count vs threshold

The obvious use of "the owner knows there are N people" is `--clustering.num-clusters=N`. It was **worse than the threshold** in most files (default threshold 0.5 versus forced N, ratio 0.5, engine alone, DER %):

| File | Forced N | Threshold 0.5 (speakers found) |
|---|---|---|
| 3 voices, clean | 47 (only 2 speakers returned) | 8.8 (4) |
| 4 voices, clean | 24.6 (3 returned) | 9.8 (6) |
| 3 voices, laptop-mic | 45.5 (2 returned) | 9.9 (8) |
| 4 voices, laptop-mic | 31.2 | 17.1 (11) |
| 4 voices, laptop-mic, chunks | 55.9 | 19.3 (9) |
| 3 voices, overlaps, laptop-mic | 34.8 | 23.2 (12) |
| 3 voices, overlaps, laptop-mic, chunks | 34.4 | 16.5 (10) |
| 3 voices, laptop-mic, chunks | 6.1 (better) | 7.7 (7) |
| 3 voices, long pauses | 6.1 (better) | 8.7 (6) |
| 2 voices (3 files), 4 voices clean via chunks | within 1 point | within 1 point |

Forcing N lets a one-off outlier (a cough, a clipped word) take one of the N slots and merges two real voices; in three files it returned fewer than N speakers. (Why was not investigated.) **Better use of the owner's number: cluster with the threshold, then keep the N speakers with the most speech** (`consolidateSpeakers({ expected: N })`, section 8). In the recommended configuration this gave the same result as the automatic consolidation in 14 of 15 files and 0.3 DER points better in the other, because the automatic rule already finds the right count there. The owner's number is still worth having: it is the only protection when the automatic rule is wrong, and N = 1 skips the whole step.

### 6.7 Short interjections, overlap, silence, solo, short meeting

- **Short interjections ("Oui.", "D'accord.", under 2 s).** With 2 voices they were attributed correctly 9/9 and 13/17; with 3 or 4 voices only 1/8 to 8/10 per file (61 of 129 in total, 47 %, consolidated). The engine often lacks enough audio to embed a one-word turn and gives it to the neighbouring speaker. For the transcript this matters less than it sounds: a "Oui." is its own whisper segment, so one wrong label on one short line.
- **Overlap.** The engine emits both speakers during overlap (it is overlap-aware), but with 3 voices through a laptop-mic chain the error on overlapped frames was 26 to 28 % (11 % for 2 clean voices). A transcript segment still gets only one label, so overlap lowers accuracy rather than being represented.
- **Silence and noise.** 60 s of pink noise: exit 0, "No speakers found", no turns, 0.6 s. Long pauses (4 to 14 s) cost nothing: 3 voices with pauses scored like the dense file.
- **One speaker.** Stays one speaker at thresholds 0.5, 0.7 and 0.9.
- **Very short meeting (31 s, 3 utterances).** Unstable: at window shift 0.5 and threshold 0.7 one of the two voices was swallowed (47.8 % DER), at shift 0.25 the same file was perfect (1.7 %); at threshold 0.5 it returned 3 speakers. With a handful of turns there is too little audio to cluster reliably; do not diarize under about one minute of speech, or accept it as unreliable.

### 6.8 Mapping onto real whisper segments

The same chunks were transcribed the way the app does it (each webm chunk converted to 16 kHz mono WAV, `whisper-cli -m ggml-base.bin -l fr -oj`, offsets shifted by chunk index x 10 s), giving 41 to 66 segments per file, and labelled with the rules of section 8 from the diarization turns above. The label of each segment was compared with the true speaker (the true turn that overlaps it most):

| File (via chunks) | Segments | Segments labelled with the right speaker | Segments that really contain 2 speakers (less than 80 % one voice) | of which the majority label was right | Segments flagged `mixed` | of which really mixed |
|---|---|---|---|---|---|---|
| 3 voices, laptop-mic | 52 | **98.1 %** | 6 | 6 | 4 | 4 |
| 4 voices, clean | 65 | **90.8 %** | 5 | 4 | 5 | 2 |
| 4 voices, laptop-mic | 41 | **92.7 %** | 10 | 7 | 4 | 4 |
| 3 voices, overlaps, laptop-mic | 52 | **86.5 %** | 17 | 14 | 12 | 10 |

Labels were right for 87 to 98 % of the real segments. The errors are two kinds: segments that straddle two speakers (the minority speaker's words get the majority label; 5 to 17 per file) and the clustering confusion of section 7. The `mixed` flag (a second speaker covers at least 25 % of the segment) caught most straddling segments with few false alarms (4 of 4, 2 of 5, 4 of 4, 10 of 12), so it is a usable "speakers uncertain" signal if the review screen ever wants one. Whisper base quality on degraded synthetic audio is poor in places (misheard words); that is independent of this spike. Ground truth for these rows is the synthesis timeline, so these are again synthetic results.

## 7. Failure modes

| # | Failure | Evidence | Consequence and handling |
|---|---|---|---|
| 1 | **Similar voices are merged.** | In the clean 4-voice file 11 s (shift 0.25) to 18 s (shift 0.5) of Jacques's speech were given to Thomas's cluster (two male French voices). | The most likely real-world failure: two colleagues with similar voices become one "Speaker". The owner's rename/merge cannot split them. Mitigation: the section 11 test with the owner's actual colleagues is the gate. |
| 2 | **Quiet or distant speaker with few turns.** | The 4th voice (-11 dB, noisy, 10 % of turns): 4 voices on the laptop-mic chain scored 10 to 22 % DER depending on the run; short turns right 1/8 to 3/8. | Weakest case. Real meetings with one person far from the laptop will look like this. |
| 3 | **Short interjections get the wrong speaker** with 3 or more voices. | 1/8 to 8/10 right (section 6.7). | Cosmetic (one wrong line), not fixable by threshold. |
| 4 | **Overlapped speech** is attributed with 26 to 28 % error (3 voices, laptop mic). | Section 6.7. | One label per segment cannot represent it. |
| 5 | **Over-splitting at the default threshold.** | 3 voices became 8 and 4 voices 11 (threshold 0.5); 2 voices became 4 at the default window shift. | Use 0.7 and consolidate micro-speakers. |
| 6 | **Threshold cliff.** | 0.9 collapsed to 1 to 3 speakers for three models; WeSpeaker ResNet34 collapses above 0.5. | Threshold is model-specific configuration; changing the model means re-validating it. |
| 7 | **Short meetings are unstable.** | 31 s file: perfect or 48 % wrong depending on settings. | Skip diarization under about one minute of speech. |
| 8 | **Results vary by several points between settings and runs** on hard files. | Section 6.2. | Do not tune on one recording. |
| 9 | **Timeline drift** if chunk decoding is not padded. | 5.8 ms lost per chunk, 0.6 s over 18 minutes. | Pad each chunk to its declared `duration_ms` (section 9.3). |
| 10 | **Bad input and missing files** exit 255 with the reason only on stderr; wrong sample rate is refused, not resampled; a missing model prints the usage text and exits 255; **no speech is exit 0 with no turns**. | Tested for 44.1 kHz stereo, truncated WAV, empty file, text file, missing audio, missing segmentation model, missing embedding model, 60 s of noise. | The adapter maps exit 255 to `unavailable`, empty output to "no speech", and must not treat empty stdout as an error. |
| 11 | **stdout is not only turns** (config echo with model paths, `Started`). | Section 4. | Parse with a strict pattern; never log stdout (it contains paths). |
| 12 | **Memory grows with length** (about 10 MB per minute). | 847 MB at 60 min. | Cap meeting length (default 120 minutes), skip beyond. |
| 13 | **Models are Chinese- or English-trained**, French worked on TTS. | Section 6.3. | Real French speakers, accents and code-switching are unverified. |
| 14 | **Unsigned binary** (ad-hoc signature, not notarized). | `codesign -dv`: Mach-O thin arm64, ad-hoc. | Fine with `curl`; a browser download is blocked by Gatekeeper until the quarantine flag is cleared. |

No alternative (FluidAudio CoreML, pyannote in a Python venv) was evaluated: sherpa-onnx did not fail and is not clearly insufficient, so the issue's condition for evaluating one was not met. If section 11 shows failure 1 on real voices, a stronger embedding (pyannote 3.1 pipeline or FluidAudio) is the next thing to try, with the same scripts.

## 8. Mapping speaker turns to transcript segments

Inputs: transcript segments with meeting-relative `start_ms`/`end_ms` (after `shiftToMeetingTime`) and diarization turns in seconds from the start of the whole-meeting WAV (which equals meeting time, thanks to the padding in 9.3). Implemented as pure functions in `scripts/spikes/diarization/map-speakers.mjs` (`assignSpeakers`, `consolidateSpeakers`); the production module would be the same logic in integer milliseconds.

Rules, in order:

1. **Names by first appearance.** Turns are sorted by start; the first cluster to speak is `Speaker A`, the next `Speaker B`, and so on (after Z: `Speaker 27`...). Labels therefore do not depend on the engine's ids and are stable for a given diarization result.
2. **Maximum overlap.** A segment gets the speaker whose turns overlap it for the longest total time (all of that speaker's turns are summed).
3. **Ties** (equal overlap within 1 ms): the speaker whose turn covers the start of the segment; still tied, the speaker who appeared first.
4. **Gaps** (no turn overlaps the segment, for example a word in a pause the engine called silence): the nearest turn if the segment is within 1 s of it (distance from the segment middle to the turn, minus half the segment length); otherwise the speaker of the previous labelled segment; the very first segment with nothing around it keeps `Speaker 1`.
5. **Mixed flag.** If a second speaker covers at least 25 % of the segment, the segment is flagged `mixed`. In the test it was a precise warning (section 6.8). v1 stores nothing for it (no column); it is the first thing to add if the review screen wants to show "speakers uncertain" on a line.
6. **Consolidation before assignment** (`consolidateSpeakers`): clustering leaves micro-speakers (a cough, one short interjection). Speakers with less than 5 % of the speech or less than 8 s are removed, or, when the owner gave a number N, only the N speakers with the most speech are kept. A removed speaker's turn goes to the kept speaker that overlaps it most, else to the nearest kept turn in time (previous one on a tie). Adjacent turns of one speaker closer than 0.5 s are merged.

Worked cases (turns: A 0-5 s, B 5-10 s, A 12-20 s):

| Segment | Result | Rule |
|---|---|---|
| 1-4 s | A | 2 |
| 4-10 s (1 s A, 5 s B) | B, not mixed (A share 17 %) | 2 |
| 2.5-7.5 s (2.5 s each) | A, mixed | 3: A covers the start |
| 10.2-10.8 s | B (turn ended at 10) | 4 |
| 11.3-11.9 s | A (turn starts at 12) | 4 |

Known limit, deliberate: a segment is never split. Whisper segments are per 10 s chunk and can contain a change of speaker; the text cannot be cut at the right word without word timestamps, so the segment takes the majority speaker and the minority part is mislabelled. Splitting on word timestamps (`whisper-cli -ml 1` or `--output-json-full`) is a possible v2 and costs transcription changes; section 6.8 counts 5 to 17 straddling segments per 4-minute file, so it is worth revisiting only if the review screen needs it.
## 9. Integration design

Fits the existing hexagon (`CLAUDE.md` sections 4 and 5, `docs/PLAN.md` section 8). Nothing below is built by this spike.

### 9.1 Shape

```
src/ports/speaker-diarizer.ts          port (small, role-specific)
src/domain/transcription/speaker-turns.ts   pure: labels by first appearance, consolidate, assign to segments
src/adapters/diarization/
  config.ts                            env parsing, like src/adapters/stt/config.ts
  sherpa-onnx-diarizer.ts              real adapter: spawns the binary through run-capture.ts
  fake-diarizer.ts                     deterministic fake with failure switches
  meeting-wav.ts                       builds the whole-meeting WAV in a private temp dir
src/app/transcription/diarize-step.ts  use case: build WAV, diarize, relabel, always clean up
```

```ts
// src/ports/speaker-diarizer.ts
export interface DiarizeRequest {
  /** 16 kHz mono 16-bit WAV on local disk, made by the caller in a private temp directory. */
  wavPath: string;
  durationMs: number;
}
/** `cluster` is the engine's anonymous id (0, 1, 2...). It carries no identity and is not stored. */
export interface SpeakerTurn { cluster: number; startMs: number; endMs: number }
export interface SpeakerDiarizer {
  /** Zero turns with success means "no speech found". Failures are ProviderError (never thrown). */
  diarize(request: DiarizeRequest): Promise<Result<SpeakerTurn[], ProviderError>>;
}
```

- **Real adapter** (`sherpa-onnx-diarizer.ts`): `runCapture` (stdout is the result, so it fits `run-capture.ts`; `stdin: ""`, `maxOutputBytes` 1 MiB, SIGKILL at the deadline, explicit environment with only `TMPDIR`, a private empty cwd). stderr is already discarded by the runner, which is what we want: the binary writes the model paths and its progress there. Argument vector (fixed, no shell): `--clustering.cluster-threshold=<n> --segmentation.pyannote-model=<path> --embedding.model=<path> --segmentation.pyannote-window-shift-ratio=<n> --segmentation.num-threads=<n> --embedding.num-threads=<n> <wavPath>`. Parse stdout line by line with the strict pattern `^(\d+\.\d{3}) -- (\d+\.\d{3}) speaker_(\d{2})$` and ignore every other line (stdout also carries a config echo and `Started`); then validate: `0 <= start < end <= durationMs + 1 s`, at most 20 000 turns, cluster id below 64; anything else is `unavailable`. Mapping of outcomes, same style as the whisper adapter: `not_found` (binary or model missing) and exit 255 = `unavailable`, `timeout` = `timeout`, exit 0 with no turns = success with an empty list. Messages are fixed text (no paths, no tool output). Never `rate_limited`.
- **Fake** (`fake-diarizer.ts`): deterministic turns from the duration (for example alternating two clusters every 20 s, with a short interjection), `failWith(kind)` and `emptyResult()` switches, like `fake-transcriber.ts`. The shared contract test (CLAUDE.md section 5, Liskov) runs against the fake and against the real adapter pointed at a stub executable script that prints canned stdout, exits 255, hangs, or prints garbage: every path of the table above has a test.
- **Config** (`DIARIZATION_PROVIDER=none|fake|sherpa`, default `none`, so nothing changes until someone opts in): `DIARIZATION_SHERPA_BIN`, `DIARIZATION_SEGMENTATION_MODEL`, `DIARIZATION_EMBEDDING_MODEL` (absolute paths, checked readable like `STT_WHISPER_MODEL`), `DIARIZATION_CLUSTER_THRESHOLD` (default `0.7`), `DIARIZATION_WINDOW_SHIFT` (default `0.25`), `DIARIZATION_THREADS` (default `4`), `DIARIZATION_MAX_MEETING_MINUTES` (default `120`; longer meetings skip diarization), `DIARIZATION_TIMEOUT_MS` (default `max(120 s, 0.5 x duration)`). Node and self-hosted only, like the Whisper adapter: Workers cannot spawn processes. Models are never bundled (licences, section 3). `.env.example` gets commented placeholders only.
- **Settings screen**: the existing provider status shows "Speaker detection: off | ready | binary or model missing", from a cheap readability check (no audio, no spawn). Screen work belongs to the screens lane, not to the adapter PRs.

### 9.2 Where it runs: a step at the end of the transcription job

After the last chunk is transcribed and before the summary is queued, so the summarizer already sees speaker labels (it receives segments as position, speaker, text). A separate `diarize` job kind was considered and rejected for v1: `job.kind` has a CHECK constraint, so a new kind means rebuilding the table in a migration, and the step is best-effort by design. Revisit if it ever needs its own retry budget.

In `runTranscription` (`src/app/transcription/transcribe-job.ts`):

1. Transcribe every chunk exactly as today, but when diarization is enabled **do not purge per chunk** (today: `if (retentionHours === 0) await purgeChunkAudio(...)` inside the loop and in the `transcribed` branch, which is also the replay path).
2. If every chunk transcribed (`failures.length === 0`) and the meeting is within `DIARIZATION_MAX_MEETING_MINUTES`, call `diarizeMeeting(...)` (new use case, never throws, always returns). Its outcome is `labelled | skipped(reason) | failed(code)`, logged as codes and counts only.
3. Then, in a `finally`-style block that runs whatever happened in step 2, purge the audio of every chunk when `retentionHours === 0` (the existing `purgeChunkAudio`, which already refuses chunks that are not `transcribed`), then enqueue `summarize` as today.

So the rule "raw audio is deleted after transcription" changes from **per chunk** to **per meeting, after speaker detection finished or was skipped**, and only when `DIARIZATION_PROVIDER` is not `none`. With `none` the code path is byte-for-byte today's. Consequences to state in the PR and in `docs/DATA_MODEL.md` section 5:

- Raw audio of a meeting now lives until its last chunk is transcribed plus the diarization time (minutes, bounded by the timeout), instead of seconds per chunk. If the transcription job fails or is retried, the already-transcribed chunks keep their audio until the job succeeds or `failMeetingProcessing` runs; the hourly retention sweeper (`findExpiredTranscribed`, window 0) is the backstop that purges them. This is a real, visible change of the retention promise and needs the owner's explicit agreement.
- A replay after a crash finds chunks `transcribed` with audio still present and simply runs the step again (idempotent, see 9.4). If audio is already gone (purged by an earlier run, or by the sweeper) the step is `skipped(audio_missing)`: no error, labels stay as they are.
- Failed chunks: diarization is not attempted while any chunk failed, so a partial transcript never gets labels computed on missing audio.

### 9.3 Whole-meeting WAV (temporary, private)

`meeting-wav.ts`, same discipline as `whisper-cpp-transcriber.ts`: `mkdtemp` in the OS temp directory (random name, mode 0700), fixed file names, nothing derived from ids or content, removed in `finally`. For each chunk in `seq` order: `chunkStore.getChunk` (decrypts), write it with mode 0600, decode with `ffmpeg` using the **same allowlisted demuxer, `-protocol_whitelist file` and flags as the Whisper adapter** (extract that table into a shared helper in the PR that adds the second user; today there is one), to raw 16 kHz mono signed 16-bit; **pad with zeros or truncate each chunk to exactly `duration_ms x 16` samples** (`audio_chunk.duration_ms`), then append to the meeting file. A header is written at the end. Padding is not cosmetic: decoding webm/opus loses about 6 ms per chunk (measured: 25 chunks, 144 ms short), and segment times are `chunkStartOffsets` = sums of `duration_ms`, so without padding the WAV drifts 0.6 s over 18 minutes against the transcript timeline. A sequence number that was never uploaded adds nothing, exactly like `chunkStartOffsets`.

Size: 1.9 MB per minute; 120 minutes = 230 MB on disk (the 4 hour per-meeting limit would be 460 MB, hence the configurable cap). The WAV is decrypted audio on local disk for the duration of the step: the same exposure the Whisper adapter already has per chunk, for longer. Mitigations: mode 0700 directory, deleted in `finally`, and a startup/retention-job sweep removing `willy-diarize-*` directories older than one hour (a SIGKILL skips `finally`). FileVault is the answer to a stolen laptop, as for the database.

### 9.4 Relabelling and idempotency

`diarizeMeeting` reads the meeting's segments (decrypted ids and times only, never text: it does not need the text), runs `assignSpeakers` (section 8) and writes the labels through one new repository method:

```ts
// ChunkRepository (or a small TranscriptLabelRepository, to keep the port small)
relabelSpeakers(ownerId, meetingId, labels: readonly { chunkSeq: number; segIndex: number; speaker: string }[]):
  Promise<{ updated: number }>;
```

One transaction, `owner_id = ?` from the session-derived job, composite key `(meeting_id, chunk_seq, seg_index)`. It updates **only rows where `speaker_label = speaker_label_original`**, so an owner's rename (`rename_speaker` / `merge_speaker`, which change `speaker_label` and keep the original) is never overwritten by a replay or a later re-run, and it sets both columns to the new label (the diarizer is the "provider" for this column). Replaying the step writes the same labels: a no-op. Tests required by `CLAUDE.md` section 3: owner A cannot relabel owner B's meeting, guessed ids, replay is a no-op, an owner edit survives a replay, unknown segment keys change nothing, a purged or deleting meeting is skipped.

### 9.5 Labels, privacy and what is NOT stored

- Anonymous labels `Speaker A`, `Speaker B`, ... in order of first appearance (section 8). No names, no inference of who someone is, nothing about employees: consistent with the non-goals.
- **No voice prints.** Speaker embeddings exist only inside the spawned process's memory, the binary has no option to write them, and the adapter parses turns only. Nothing speaker-specific is persisted: no cross-meeting identity, no enrolment. A feature that recognises the same person in another meeting would be biometric identification and is out of scope (and a different legal category).
- Logs: ids, durations, counts and codes (`diarization.labelled {speakers: 3, segments: 52}`), never audio, turns' text, paths or the binary's output (A09).
- Permanent deletion needs no change: the temp WAV never outlives the step, and the labels are columns of rows the deletion job already erases.

### 9.6 Failure behaviour: never fail the meeting

Any problem (binary or model missing, timeout, exit 255, garbage output, meeting too long, no turns, audio missing, relabel error) ends the step as `skipped` or `failed`: labels stay `Speaker 1`, the summary is queued, the meeting reaches `review` exactly as it does today, and the review screen can say "Speakers could not be detected" from a code on the job outcome (the job row already holds `last_error_code`). No retry loop: speaker detection is an enhancement and the owner can fix labels by hand with rename/merge. A later "re-run speaker detection" action is possible only while audio is retained (retention > 0) and is not part of v1.

### 9.7 Owner-supplied number of speakers

`meeting.expected_speakers INTEGER NULL CHECK (expected_speakers BETWEEN 1 AND 8)`, set on the new-note form (optional, "How many people will speak?") or in the review screen. Use:

- `1`: skip diarization entirely (also saves the audio retention change).
- `2..8`: run the normal threshold clustering, then `consolidateSpeakers({ expected })` keeps the N speakers with the most speech and hands the others' turns to the nearest kept speaker. **Do not pass the number as `--clustering.num-clusters`**: measured in this spike, forcing the cluster count was worse than the threshold (section 6.6), because an outlier cluster of a few seconds takes one of the N slots.
- empty: automatic, with the same consolidation (`minShare 5 %`, `minSeconds 8`) removing micro-speakers.

Screens are another lane (CLAUDE.md section 11): this field is the contract, the form is theirs.

### 9.8 Consent and retention wording

Needs a product decision (not mine): the consent statement and the README retention section promise that raw audio is deleted after transcription. With this feature on, the honest text is: "Audio is kept on this computer only while the meeting is being processed, then deleted. The app tells the voices in this meeting apart to label speakers (Speaker A, B...); it does not identify anyone and keeps no voice data." A changed statement is a new `consent_statement_version`; capture must not start under a statement that promises something the app no longer does, and consent already recorded under the old version keeps its old text. Update `README.md` ("Retention, deletion and external-data cleanup"), `docs/DATA_MODEL.md` section 5 and the settings screen copy in the same PR as the behaviour change. Participants hear nothing about this on the call: the consent statement is where "voices are analysed" must be visible to the owner, who tells the others (the product never claims consent on their behalf).

## 10. Effort (pull requests)

| # | PR | Content | Size |
|---|---|---|---|
| 1 | `feat(transcription): map speaker turns to segments` | `speaker-turns.ts` (labels, consolidate, assign, ties, gaps, mixed flag) with unit tests from the table in section 8; no I/O | small, about 250 lines with tests |
| 2 | `feat(diarization): SpeakerDiarizer port and fake` | port, fake, config parsing, composition wiring (`none` by default), contract test suite, `.env.example` | small, about 300 |
| 3 | `feat(diarization): sherpa-onnx adapter` | spawned runner, strict parser and validation, stub-executable integration tests (success, empty, exit 255, timeout, garbage, missing model), `scripts/setup-diarization.sh` with pinned checksums | medium, about 400 |
| 4 | `feat(diarization): meeting WAV from chunks` | shared ffmpeg decode helper extracted from the Whisper adapter, padding to `duration_ms`, private temp dir, stale-directory sweep, tests incl. drift and cleanup in `finally` | medium, about 350 |
| 5 | `feat(transcription): speaker detection step before purge` | `diarize-step.ts`, `relabelSpeakers` (D1 and SQLite), purge rule change behind the flag, replay and cross-owner tests, docs (`DATA_MODEL.md`, README retention, consent wording) | medium, 400-500, the risky one: review the retention change line by line |
| 6 | `feat(meetings): expected number of speakers` | migration (`expected_speakers`), use case, form field; screen part coordinated with the screens lane | small, about 200 |
| 7 | `feat(settings): speaker detection status` | provider status line, setup instructions | small |

Total: about 6 to 7 small PRs, roughly 2 to 3 working days of focused work for one developer, plus a half day with the owner running section 11 on real voices BEFORE PR 3 starts.
## 11. How the owner tests it with real voices (the deciding experiment)

Everything stays on the laptop: the scripts only call `ffmpeg`, `whisper-cli` and the local diarization binary, and never open a network connection. Use a short recording made on purpose with people who agreed (read an article aloud, interrupt each other, one person further from the laptop than the other), not a real confidential meeting. 2 to 3 minutes of two or three people is enough.

```bash
# 0. install once, section 2 ($SPIKE), then from the repository root:
SPIKE="$HOME/willy-diarization"
D=scripts/spikes/diarization
export SHERPA_BIN="$SPIKE/bin/sherpa-onnx-v2.0.1-osx-arm64-shared-no-tts/bin/sherpa-onnx-offline-speaker-diarization"
export SEG_MODEL="$SPIKE/models/pyannote/sherpa-onnx-pyannote-segmentation-3-0/model.onnx"
export EMB_MODEL="$SPIKE/models/eres2net.onnx"

# 1. record with QuickTime ("New Audio Recording") or Voice Memos, export as ~/Desktop/test.m4a, then
#    send it through the app's audio path (10 s webm/opus chunks, rebuilt into one WAV):
ffmpeg -i ~/Desktop/test.m4a -ar 16000 -ac 1 -c:a pcm_s16le "$SPIKE/test.wav"
bash $D/via-chunks.sh "$SPIKE/test.wav" "$SPIKE/chunks" "$SPIKE/test-rebuilt.wav"   # $SPIKE/chunks must not exist yet

# 2. who spoke when (2 = number of people; leave it out to let the tool decide)
$D/run-diarization.sh "$SPIKE/test-rebuilt.wav" auto 0.7 > "$SPIKE/test.turns.txt"
node $D/postprocess-turns.mjs "$SPIKE/test.turns.txt" 2 > "$SPIKE/test.cons.txt"

# 3. the transcript with speaker labels, exactly as the app would produce it
#    (WHISPER_MODEL = the same ggml model file you use for STT_WHISPER_MODEL; type the path, do not source .env)
WHISPER_MODEL=/path/to/ggml-base.bin
node $D/transcribe-chunks.mjs "$SPIKE/chunks" "$WHISPER_MODEL" "$SPIKE/segments.json"
node $D/print-labelled.mjs "$SPIKE/segments.json" "$SPIKE/test.turns.txt" 2
```

Read the printed lines against what you remember: `[01:12] Speaker B  ...`. Then try `0.6` and `0.8` instead of `0.7` in step 2, and the number of people left out, to see how sensitive it is. To get a number, write the true timeline by listening to the recording (`[{"speaker":"A","start":0,"end":12.5}, ...]`, seconds, one entry per turn) and run `node $D/score-diarization.mjs truth.json "$SPIKE/test.cons.txt"`.

Suggested pass bar before any production work (my proposal, the owner decides): with two people at least 9 lines in 10 carry the right label; with three at least 4 in 5; and no pair of colleagues is merged into one label for more than a third of their speech (failure 1 in section 7). Delete the recording and `$SPIKE/chunks` afterwards.

## 12. What was not verified

- **Any real human voice.** All audio is synthetic (section 1). This is the single biggest unknown and the reason the recommendation is conditional.
- French accents and dialects, more than 4 speakers, rooms with keyboard and fan noise, people moving relative to the microphone, laughter and coughs.
- Whisper was exercised only with the `base` model on synthetic audio (the model named by `STT_WHISPER_MODEL`); transcript quality on real audio is a separate question.
- The timings were measured on a shared machine with a load average of 5 to 10 (once 25), not an idle one. Peak memory beyond 60 minutes is extrapolated.
- The 60-minute file is the 18-minute file repeated, so its accuracy is not meaningful and was not scored; it measures speed and memory only.
- Only the macOS arm64 build was tried: not Intel, Linux or Windows, not the Python/Node/Swift packages of sherpa-onnx, not the `coreml` provider.
- The licence of the ERes2Net model and the terms of the training data behind the segmentation model (section 3) were read from public pages, not verified at the source, and are not legal advice.
- No production code exists. The mapping and consolidation rules are spike scripts exercised by the experiments above and a hand-run table of ties and gaps (section 8); they are not in the Vitest suite. The adapter, the WAV builder, the job step, the purge-rule change and the relabel query described in section 9 were designed, not built or run, so their behaviour (for example replay and cross-owner tests) is unverified.
- The consent and retention wording in section 9.8 is a proposal that needs a product decision.
- Running diarization at the same time as the dev server and the Whisper jobs was not tested (the extra memory is 0.4 to 0.9 GB).
- No alternative engine (FluidAudio, pyannote in Python) was evaluated, because sherpa-onnx did not fail.

## 13. Reproducing the experiments

Scripts (all local, Node 22+ without dependencies except `ffmpeg`, `say`, `whisper-cli` and the sherpa-onnx binary), in `scripts/spikes/diarization/`:

| Script | What it does |
|---|---|
| `make-synthetic.mjs` | Builds a French conversation with `say` voices (`--speakers 1..4 --seconds N --seed N [--overlap] [--levels] [--pauses]`), writes a 16 kHz WAV and the exact `*.truth.json` timeline |
| `degrade.sh` | Laptop-microphone-like filter chain (band limit, level, echo, noise) |
| `via-chunks.sh` | Encodes 10 s webm/opus chunks like a browser upload, decodes and rebuilds one WAV (padded to the declared chunk duration) |
| `run-diarization.sh` | Runs the binary on one WAV, prints turns, time and peak memory |
| `score-diarization.mjs` | Frame-level DER with optimal speaker mapping, overlap-only DER, short-turn accuracy |
| `postprocess-turns.mjs`, `map-speakers.mjs` | Consolidation of micro-speakers (with an optional expected count) and the turn-to-segment mapping rules of section 8 |
| `transcribe-chunks.mjs` | Transcribes chunk files the way the app does (ffmpeg then `whisper-cli -l fr -oj`), meeting-relative segments |
| `eval-mapping.mjs`, `print-labelled.mjs` | Scores labelled segments against the truth; prints a labelled transcript for a human to judge |

One example, the "3 voices, laptop-mic, via chunks" row:

```bash
D=scripts/spikes/diarization; A=$SPIKE/audio; mkdir -p "$A"
node $D/make-synthetic.mjs --out "$A" --name mic-raw-3 --speakers 3 --seconds 240 --seed 3 --levels
bash $D/degrade.sh "$A/mic-raw-3.wav" "$A/mic-3.wav"
bash $D/via-chunks.sh "$A/mic-3.wav" "$SPIKE/chunks-mic-3" "$A/mic-3-opus.wav"
SHIFT=0.25 $D/run-diarization.sh "$A/mic-3-opus.wav" auto 0.7 > "$SPIKE/mic-3.turns.txt"
node $D/postprocess-turns.mjs "$SPIKE/mic-3.turns.txt" > "$SPIKE/mic-3.cons.txt"
node $D/score-diarization.mjs "$A/mic-raw-3.truth.json" "$SPIKE/mic-3.cons.txt"
```

Seeds used: clean-N and mic-N use seed N; ovl-2 seed 12; ovl-3 seed 13 (`--overlap --levels`); pause-3 seed 33 (`--levels --pauses`); long-4 seed 44 (1080 s); solo-1 seed 51 (`--pauses`); short-2 seed 52 (25 s, `--levels`). Results can differ slightly if macOS updates the `say` voices.
