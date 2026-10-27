#!/usr/bin/env bash
# Unpack the compressed prediction file in the repository's data folder (it is stored as .csv.gz to stay
# under GitHub's 100 MB file limit). Run once after cloning.
#   setup/unpack_data.sh [data folder, default data/Hackathon_data]
set -euo pipefail
cd "$(dirname "$0")/.."
DATA="${1:-data/Hackathon_data}"
GZ="$DATA/Output_Prediction/Output.csv.gz"
[ -f "$GZ" ] || { echo "not found: $GZ" >&2; exit 1; }
if [ -f "${GZ%.gz}" ]; then echo "already unpacked: ${GZ%.gz}"; else gunzip -k "$GZ" && echo "unpacked: ${GZ%.gz}"; fi
