# Data

The repository includes the four files the pipeline needs:

- `Hackathon_data/Output_Prediction/Output.csv.gz`: the pre-existing model's predictions (unpack once with `setup/unpack_data.sh`)
- `Hackathon_data/Whole_Samples/DrugComb_V2_measured_combinations.csv`: the measured drug combinations
- `Hackathon_data/Cell_Drug_Annotation_Mapping/Drug_metadata.csv`: drug names, ids and target genes
- `Hackathon_data/Cell_Drug_Annotation_Mapping/cell_lines_metadata.csv`: cell lines and tissues

`setup/load_source_files.sh` loads them into Zetaris. The model's feature files (modalities) are proprietary
and not included; without them the dashboard's modality panel stays empty and everything else works.
