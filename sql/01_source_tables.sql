-- =============================================================================
-- 01 Source tables: register the hackathon data files in Zetaris.
--
-- The Hackathon_data folder is mounted read-only into the Zetaris engine at
--   /home/zetaris/customer-data/shared/drug-synergy-data/
-- (see setup/load_source_files.sh and setup/docker-compose.override.yml).
-- Lightning only reads local files below /home/zetaris/customer-data/shared.
--
--   DRUG_SYNERGY_DATA.predictions            model predictions + measured values, both drug orders (719,112 rows)
--   DRUG_SYNERGY_DATA.drug_metadata          drug bank with curated mechanism and targets (3,139 drugs)
--   DRUG_SYNERGY_DATA.cell_lines_metadata    DrugComb cell lines (2,320)
--   DRUG_SYNERGY_DATA.measured_combinations  measured drug combinations, DrugComb v2 (359,556)
--   (the model's train and test samples, lov_train / lov_test, are optional: sql/01b_train_test_samples.sql)
-- The model-feature files (Drug_Modalities, Cell_Modalities) are stored but not registered.
-- =============================================================================

CREATE LIGHTNING DATABASE DRUG_SYNERGY_DATA DESCRIBE BY "Drug synergy hackathon data";
CREATE LIGHTNING FILESTORE TABLE predictions FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/drug-synergy-data/Output_Prediction/Output.csv", header "true", inferSchema "true", delimiter ",");
CREATE LIGHTNING FILESTORE TABLE drug_metadata FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/drug-synergy-data/Cell_Drug_Annotation_Mapping/Drug_metadata.csv", header "true", inferSchema "true", delimiter ",", quote '"', escape '"', multiLine "true");
CREATE LIGHTNING FILESTORE TABLE cell_lines_metadata FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/drug-synergy-data/Cell_Drug_Annotation_Mapping/cell_lines_metadata.csv", header "true", inferSchema "true", delimiter ",", quote '"', escape '"');
CREATE LIGHTNING FILESTORE TABLE measured_combinations FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/drug-synergy-data/Whole_Samples/DrugComb_V2_measured_combinations.csv", header "true", inferSchema "true", delimiter ",");
