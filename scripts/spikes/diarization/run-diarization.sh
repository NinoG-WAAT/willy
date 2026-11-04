#!/bin/bash
# Spike #104: runs sherpa-onnx offline speaker diarization on one local WAV and prints the turns.
# Nothing is uploaded; the audio is only read by the local binary. Convert any recording first:
#   ffmpeg -i recording.m4a -ar 16000 -ac 1 -c:a pcm_s16le recording.wav
#
#   SHERPA_BIN=/path/to/sherpa-onnx-offline-speaker-diarization \
#   SEG_MODEL=/path/to/model.onnx EMB_MODEL=/path/to/embedding.onnx \
#   run-diarization.sh RECORDING.wav [NUM_SPEAKERS | auto] [THRESHOLD]
#
# "auto" (default) clusters with THRESHOLD (default 0.7; larger = fewer speakers). A number fixes
# the cluster count, which the spike found WORSE than auto plus postprocess-turns.mjs N (see
# docs/spikes/diarization.md). Env: THREADS (default 4), SHIFT (window shift ratio, default 0.25;
# 0.1 is the binary's slower default). Turns go to stdout as "start -- end speaker_NN" (seconds);
# duration, time and peak memory go to stderr.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: run-diarization.sh RECORDING.wav [NUM_SPEAKERS|auto] [THRESHOLD]" >&2; exit 2; }
: "${SHERPA_BIN:?set SHERPA_BIN}" "${SEG_MODEL:?set SEG_MODEL}" "${EMB_MODEL:?set EMB_MODEL}"
wav=$1
speakers=${2:-auto}
threshold=${3:-0.7}
if [ "$speakers" = "auto" ]; then
  cluster=(--clustering.cluster-threshold="$threshold")
else
  cluster=(--clustering.num-clusters="$speakers")
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
/usr/bin/time -l "$SHERPA_BIN" \
  "${cluster[@]}" \
  --segmentation.pyannote-model="$SEG_MODEL" \
  --embedding.model="$EMB_MODEL" \
  --segmentation.num-threads="${THREADS:-4}" --embedding.num-threads="${THREADS:-4}" \
  --segmentation.pyannote-window-shift-ratio="${SHIFT:-0.25}" \
  "$wav" > "$tmp/out.txt" 2> "$tmp/err.txt" || { cat "$tmp/err.txt" >&2; exit 1; }
grep -E '^\s*[0-9.]+ -- [0-9.]+ ' "$tmp/out.txt"
grep -E 'Duration|Elapsed|Real time factor' "$tmp/err.txt" >&2 || true
grep -E 'maximum resident set size' "$tmp/err.txt" >&2 || true
