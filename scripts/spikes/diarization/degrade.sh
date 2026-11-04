#!/bin/bash
# Spike #104: imitates a laptop microphone in a small room: band-limited, quiet, a little reverb,
# steady pink noise (about 13 dB below the speech). Local only (ffmpeg).
#   degrade.sh IN.wav OUT.wav
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: degrade.sh IN.wav OUT.wav" >&2; exit 2; }
ffmpeg -v error -y -i "$1" -filter_complex \
  "[0:a]highpass=f=150,lowpass=f=5500,aecho=0.8:0.6:35|60:0.25|0.15,volume=-14dB[s];anoisesrc=color=pink:amplitude=0.02:sample_rate=16000[n];[s][n]amix=inputs=2:duration=first:normalize=0,aformat=sample_fmts=s16:sample_rates=16000:channel_layouts=mono" \
  "$2"
