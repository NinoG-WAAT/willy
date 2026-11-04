#!/bin/bash
# Spike #104: sends a WAV through the production audio path and rebuilds one WAV from the pieces:
# 10 s chunks, each an independent webm/opus file (48 kHz, 32 kbps, like a browser upload), then
# every chunk decoded to 16 kHz mono and joined in order. Local only (ffmpeg).
#   via-chunks.sh IN.wav WORKDIR OUT.wav     (WORKDIR must be a new, private directory)
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: via-chunks.sh IN.wav WORKDIR OUT.wav" >&2; exit 2; }
in=$1
work=$2
out=$3
mkdir -p "$work"
ffmpeg -v error -y -i "$in" -ar 48000 -ac 1 -c:a libopus -b:a 32k \
  -f segment -segment_time 10 -segment_format webm -reset_timestamps 1 "$work/chunk_%03d.webm"
: > "$work/list.txt"
total_ms=0
chunks=("$work"/chunk_*.webm)
last=$((${#chunks[@]} - 1))
for i in "${!chunks[@]}"; do
  c=${chunks[$i]}
  w="${c%.webm}.wav"
  # Opus decoding drops a few ms per chunk (pre-skip): every chunk but the last is padded back to
  # its declared 10 s so that WAV time equals meeting time (the sum of duration_ms).
  if [ "$i" -lt "$last" ]; then pad=(-af apad=whole_dur=10 -t 10); else pad=(); fi
  ffmpeg -v error -y -f matroska,webm -i "$c" ${pad[@]+"${pad[@]}"} -ar 16000 -ac 1 -c:a pcm_s16le "$w"
  echo "file '$w'" >> "$work/list.txt"
  ms=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$w" | awk '{printf "%d", $1*1000+0.5}')
  total_ms=$((total_ms + ms))
done
ffmpeg -v error -y -f concat -safe 0 -i "$work/list.txt" -c copy "$out"
orig_ms=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in" | awk '{printf "%d", $1*1000+0.5}')
echo "chunks=$(ls "$work"/chunk_*.webm | wc -l | tr -d ' ') original_ms=$orig_ms sum_of_decoded_chunks_ms=$total_ms webm_bytes=$(cat "$work"/chunk_*.webm | wc -c | tr -d ' ')"
