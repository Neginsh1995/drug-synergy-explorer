#!/usr/bin/env bash
# Copy the hackathon data folder into the drug-synergy-data Docker volume,
# replacing whatever is there.
#   setup/load_source_files.sh [/path/to/Hackathon_data]   (default: data/Hackathon_data in this repository)
# The folder layout is kept. Train/test sample files named <prefix>_LOV_<split>.csv
# are stored as LOV_<split>.csv, and the measured-combinations file (Whole_Samples/DrugComb_V2_*.csv)
# as Whole_Samples/DrugComb_V2_measured_combinations.csv, so no contributor names end up in Zetaris. Run it again to load a newer version, then clear
# Zetaris's cached view of changed files (see docs/INSTALL_AND_CHECK.md).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-data/Hackathon_data}"
# the repository stores Output.csv compressed; unpack it first
[ -f "$SRC/Output_Prediction/Output.csv" ] || [ ! -f "$SRC/Output_Prediction/Output.csv.gz" ] || gunzip -k "$SRC/Output_Prediction/Output.csv.gz"
REQUIRED=(
  Output_Prediction/Output.csv
  Cell_Drug_Annotation_Mapping/Drug_metadata.csv
  Cell_Drug_Annotation_Mapping/cell_lines_metadata.csv
)
for f in "${REQUIRED[@]}"; do [ -f "$SRC/$f" ] || { echo "missing: $SRC/$f" >&2; exit 1; }; done
ls "$SRC"/Whole_Samples/DrugComb_V2_*.csv >/dev/null 2>&1 || { echo "missing: $SRC/Whole_Samples/DrugComb_V2_*.csv" >&2; exit 1; }

docker volume create --label purpose=drug-synergy-data drug-synergy-data >/dev/null
docker rm -f drug-synergy-copy >/dev/null 2>&1 || true
docker create --name drug-synergy-copy -v drug-synergy-data:/data postgres:16-alpine sh >/dev/null
trap 'docker rm -f drug-synergy-copy >/dev/null 2>&1 || true' EXIT
# empty the volume, then copy the folder in
docker run --rm -v drug-synergy-data:/data postgres:16-alpine sh -c 'rm -rf /data/* /data/.[!.]* 2>/dev/null; true'
docker cp "$SRC/." drug-synergy-copy:/data/
# 1001 is the zetaris user inside the engine container
docker run --rm -v drug-synergy-data:/data postgres:16-alpine sh -c '
  find /data \( -name ".DS_Store" -o -name "*.gz" \) -delete
  cd /data/Input_train_test_DataSamples_Drug_Drug_Cell 2>/dev/null && for f in *_LOV_*.csv; do
    [ -e "$f" ] && mv "$f" "LOV_${f##*_LOV_}"; done
  cd /data/Whole_Samples 2>/dev/null && for f in DrugComb_V2_*.csv; do
    [ "$f" != DrugComb_V2_measured_combinations.csv ] && mv "$f" DrugComb_V2_measured_combinations.csv; done
  chown -R 1001:1001 /data && find /data -type d -exec chmod 755 {} + && find /data -type f -exec chmod 644 {} +
  cd /data && find . -type f | sort'
echo "Loaded into volume drug-synergy-data."
