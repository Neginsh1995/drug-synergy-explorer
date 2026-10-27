-- =============================================================================
-- 01b Optional: the model's train and test samples (300,642 / 58,914 rows).
-- Not used by the pipeline or the pages. With Input_train_test_DataSamples_Drug_Drug_Cell/ in
-- data/Hackathon_data, run setup/load_source_files.sh, then this file.
-- =============================================================================

CREATE LIGHTNING FILESTORE TABLE lov_train FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/drug-synergy-data/Input_train_test_DataSamples_Drug_Drug_Cell/LOV_train.csv", header "true", inferSchema "true", delimiter ",", quote '"', escape '"');
CREATE LIGHTNING FILESTORE TABLE lov_test FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/drug-synergy-data/Input_train_test_DataSamples_Drug_Drug_Cell/LOV_test.csv", header "true", inferSchema "true", delimiter ",", quote '"', escape '"');
