-- =============================================================================
-- 02 Semantic layer: the drug_synergy USL in lightning.metastore.drug_synergy.
--
-- Four tables built from the source tables (01_source_tables.sql):
--   drugs                  <- DRUG_SYNERGY_DATA.drug_metadata          (3,139 rows, key pubchem_cid)
--   cell_lines             <- DRUG_SYNERGY_DATA.cell_lines_metadata    (2,320 rows, key cell_line_id)
--   synergy_results        <- DRUG_SYNERGY_DATA.predictions            (719,112 rows, key result_id)
--   measured_combinations  <- DRUG_SYNERGY_DATA.measured_combinations  (359,556 rows, key block_id)
--   synergy_results and measured_combinations: drug_1, drug_2 -> drugs; cell_line_id -> cell_lines.
--
-- Notes:
--   - result_id = '<drug_1>_<drug_2>_<cell_line>'. Each pair appears in both drug orders.
--   - tissue_id and cosmic_id are read as decimals (they have nulls) but hold whole
--     numbers; they are cast to int.
--   - The multi-table COMPILE USL must be sent as one statement; scripts/run_sql.py
--     in the Zetaris getting-started repo keeps it whole.
--   - The last statements run the data quality rules; every rule passes (0 invalid).
-- =============================================================================

CREATE NAMESPACE IF NOT EXISTS lightning.metastore;
CREATE NAMESPACE IF NOT EXISTS lightning.metastore.drug_synergy;

COMPILE USL IF NOT EXISTS drug_synergy DEPLOY NAMESPACE lightning.metastore.drug_synergy DDL
CREATE TABLE drugs (
    pubchem_cid int NOT NULL PRIMARY KEY,
    drug_id int,
    drug_name varchar(200),
    chembl_id varchar(50),
    inchikey varchar(50),
    canonical_smiles varchar(1000),
    pubchem_cid_curation varchar(200),
    inchikey_curation varchar(200),
    canonical_smiles_curation varchar(4000),
    molecular_formula varchar(50),
    clinical_phase_chembl varchar(20),
    max_clinical_phase varchar(50),
    cid_m varchar(20),
    cid_s varchar(50),
    stitch_name varchar(100),
    drugbank_id varchar(20),
    kegg_id varchar(20),
    synonyms varchar(20000),
    target_name varchar(20000),
    target_type varchar(200),
    dual_therapy_count int,
    chembl_id_check varchar(400),
    curated_moa_targets_chembl varchar(2000),
    curated_moa_target_genes_chembl varchar(2000),
    repurposinghub_match varchar(400),
    curated_target_genes_repurposinghub varchar(2000),
    target_check varchar(400),
    listed_targets_not_in_curated_sources varchar(20000),
    broad_moa varchar(400),
    appropriate_moa varchar(1000),
    detailed_moa varchar(2000),
    moa_source varchar(200),
    atc_class varchar(1000),
    annotation_review_note varchar(2000),
    literature_target_genes varchar(400),
    cancer_related_moa varchar(1000),
    cancer_moa_status varchar(100)
);
CREATE TABLE cell_lines (
    cell_line_id int NOT NULL PRIMARY KEY,
    name varchar(100),
    synonyms varchar(1000),
    cellosaurus_accession varchar(20),
    disease_id varchar(20),
    tissue_id int,
    depmap_id varchar(50),
    cell_model_passport_id varchar(20),
    cosmic_id int,
    ccle_name varchar(100),
    expression_data varchar(50),
    tissue varchar(50)
);
CREATE TABLE synergy_results (
    result_id varchar(40) NOT NULL PRIMARY KEY,
    drug_1 int NOT NULL FOREIGN KEY REFERENCES drugs(pubchem_cid),
    drug_2 int NOT NULL FOREIGN KEY REFERENCES drugs(pubchem_cid),
    cell_line_id int NOT NULL FOREIGN KEY REFERENCES cell_lines(cell_line_id),
    ground_truth_label_loewe double,
    prediction_label_loewe double,
    ground_truth_label_bliss double,
    prediction_label_bliss double,
    ground_truth_label_hsa double,
    prediction_label_hsa double,
    ground_truth_label_zip double,
    prediction_label_zip double,
    loewe_total_std double,
    loewe_aleatoric_std double,
    loewe_epistemic_std double,
    loewe_pi_lower double,
    loewe_pi_upper double,
    bliss_total_std double,
    bliss_aleatoric_std double,
    bliss_epistemic_std double,
    bliss_pi_lower double,
    bliss_pi_upper double,
    hsa_total_std double,
    hsa_aleatoric_std double,
    hsa_epistemic_std double,
    hsa_pi_lower double,
    hsa_pi_upper double,
    zip_total_std double,
    zip_aleatoric_std double,
    zip_epistemic_std double,
    zip_pi_lower double,
    zip_pi_upper double,
    sample_index int
);
CREATE TABLE measured_combinations (
    block_id int NOT NULL PRIMARY KEY,
    drug_row_id int,
    drug_1 int NOT NULL FOREIGN KEY REFERENCES drugs(pubchem_cid),
    drug_col_id int,
    drug_2 int NOT NULL FOREIGN KEY REFERENCES drugs(pubchem_cid),
    cell_line_id int NOT NULL FOREIGN KEY REFERENCES cell_lines(cell_line_id),
    conc_r_unit varchar(20),
    conc_c_unit varchar(20),
    label_zip double,
    label_loewe double,
    label_hsa double,
    label_bliss double,
    ic50_row double,
    ic50_col double,
    ri_row double,
    ri_col double,
    css_row double,
    css_col double,
    css_ri double,
    s_sum double,
    quality varchar(50),
    s_mean double,
    s_max double
);

UPDATE USL lightning.metastore.drug_synergy.drug_synergy SET DESCRIPTION 'Drug combination synergy - measured vs predicted Loewe, Bliss, HSA and ZIP scores with uncertainty, linked to curated drug and cell line reference data and the measured DrugComb combinations.';
UPDATE USL lightning.metastore.drug_synergy.drug_synergy.drugs SET TABLE DESCRIPTION 'One row per drug, keyed by PubChem CID, with curated mechanism of action and target genes.';
UPDATE USL lightning.metastore.drug_synergy.drug_synergy.cell_lines SET TABLE DESCRIPTION 'One row per cancer cell line, keyed by cell line id.';
UPDATE USL lightning.metastore.drug_synergy.drug_synergy.synergy_results SET TABLE DESCRIPTION 'One row per drug pair order and cell line - measured and predicted synergy scores, uncertainty and prediction intervals.';
UPDATE USL lightning.metastore.drug_synergy.drug_synergy.measured_combinations SET TABLE DESCRIPTION 'One row per measured drug combination block (DrugComb v2) - measured synergy scores and single-drug response summaries.';

ACTIVATE USL TABLE lightning.metastore.drug_synergy.drug_synergy.drugs AS
SELECT
    COALESCE(`PubChem CID`, 0) AS pubchem_cid,
    id AS drug_id,
    dname AS drug_name,
    chembl_id,
    InChIKey AS inchikey,
    `Canonical SMILES` AS canonical_smiles,
    CAST(`PubChem CID_For_Curation` AS string) AS pubchem_cid_curation,
    InChIKey_For_Curation AS inchikey_curation,
    `Canonical SMILES_For_Curation` AS canonical_smiles_curation,
    molecular_formula,
    CAST(`Clinical_Phase (from ChemBL)` AS string) AS clinical_phase_chembl,
    Max_Clinical_Phase AS max_clinical_phase,
    cid_m,
    cid_s,
    stitch_name,
    drugbank_id,
    kegg_id,
    synonyms,
    target_name,
    target_type,
    `Number of times drug appears in dual-therapy` AS dual_therapy_count,
    ChEMBL_id_check AS chembl_id_check,
    curated_MOA_targets_ChEMBL AS curated_moa_targets_chembl,
    curated_MOA_target_genes_ChEMBL AS curated_moa_target_genes_chembl,
    RepurposingHub_match AS repurposinghub_match,
    curated_target_genes_RepurposingHub AS curated_target_genes_repurposinghub,
    target_check,
    listed_targets_not_in_curated_sources,
    broad_MOA AS broad_moa,
    Appropriate_MOA AS appropriate_moa,
    detailed_MOA AS detailed_moa,
    MOA_source AS moa_source,
    ATC_class AS atc_class,
    annotation_review_note,
    literature_target_genes,
    cancer_related_MOA AS cancer_related_moa,
    cancer_MOA_status AS cancer_moa_status
FROM DRUG_SYNERGY_DATA.drug_metadata;

ACTIVATE USL TABLE lightning.metastore.drug_synergy.drug_synergy.cell_lines AS
SELECT
    COALESCE(id, 0) AS cell_line_id,
    name,
    synonyms,
    cellosaurus_accession,
    CAST(disease_id AS string) AS disease_id,
    CAST(tissue_id AS int) AS tissue_id,
    depmap_id,
    cell_model_passport_id,
    CAST(cosmic_id AS int) AS cosmic_id,
    ccle_name,
    expression_data,
    tissue
FROM DRUG_SYNERGY_DATA.cell_lines_metadata;

ACTIVATE USL TABLE lightning.metastore.drug_synergy.drug_synergy.synergy_results AS
SELECT
    concat_ws('_', CAST(drug_1 AS string), CAST(drug_2 AS string), CAST(cell_line AS string)) AS result_id,
    COALESCE(drug_1, 0) AS drug_1,
    COALESCE(drug_2, 0) AS drug_2,
    COALESCE(cell_line, 0) AS cell_line_id,
    Ground_Truth_label_Loewe AS ground_truth_label_loewe,
    Prediction_label_Loewe AS prediction_label_loewe,
    Ground_Truth_label_Bliss AS ground_truth_label_bliss,
    Prediction_label_Bliss AS prediction_label_bliss,
    Ground_Truth_label_HSA AS ground_truth_label_hsa,
    Prediction_label_HSA AS prediction_label_hsa,
    Ground_Truth_label_Zip AS ground_truth_label_zip,
    Prediction_label_Zip AS prediction_label_zip,
    Loewe_total_std AS loewe_total_std,
    Loewe_aleatoric_std AS loewe_aleatoric_std,
    Loewe_epistemic_std AS loewe_epistemic_std,
    Loewe_pi_lower AS loewe_pi_lower,
    Loewe_pi_upper AS loewe_pi_upper,
    Bliss_total_std AS bliss_total_std,
    Bliss_aleatoric_std AS bliss_aleatoric_std,
    Bliss_epistemic_std AS bliss_epistemic_std,
    Bliss_pi_lower AS bliss_pi_lower,
    Bliss_pi_upper AS bliss_pi_upper,
    HSA_total_std AS hsa_total_std,
    HSA_aleatoric_std AS hsa_aleatoric_std,
    HSA_epistemic_std AS hsa_epistemic_std,
    HSA_pi_lower AS hsa_pi_lower,
    HSA_pi_upper AS hsa_pi_upper,
    Zip_total_std AS zip_total_std,
    Zip_aleatoric_std AS zip_aleatoric_std,
    Zip_epistemic_std AS zip_epistemic_std,
    Zip_pi_lower AS zip_pi_lower,
    Zip_pi_upper AS zip_pi_upper,
    sample_index
FROM DRUG_SYNERGY_DATA.predictions;

ACTIVATE USL TABLE lightning.metastore.drug_synergy.drug_synergy.measured_combinations AS
SELECT
    COALESCE(block_id, 0) AS block_id,
    drug_row_id,
    COALESCE(drug_1, 0) AS drug_1,
    drug_col_id,
    COALESCE(drug_2, 0) AS drug_2,
    COALESCE(context, 0) AS cell_line_id,
    conc_r_unit,
    conc_c_unit,
    label_Zip AS label_zip,
    label_Loewe AS label_loewe,
    label_HSA AS label_hsa,
    label_Bliss AS label_bliss,
    ic50_row,
    ic50_col,
    ri_row,
    ri_col,
    css_row,
    css_col,
    css_ri,
    S_sum AS s_sum,
    quality,
    S_mean AS s_mean,
    S_max AS s_max
FROM DRUG_SYNERGY_DATA.measured_combinations;

LIST DQ USL lightning.metastore.drug_synergy.drug_synergy;
RUN DQ TABLE lightning.metastore.drug_synergy.drug_synergy.drugs;
RUN DQ TABLE lightning.metastore.drug_synergy.drug_synergy.cell_lines;
RUN DQ TABLE lightning.metastore.drug_synergy.drug_synergy.synergy_results;
RUN DQ TABLE lightning.metastore.drug_synergy.drug_synergy.measured_combinations;

-- TEARDOWN (commented out; confirm scope first):
-- REMOVE USL drug_synergy NAMESPACE lightning.metastore.drug_synergy;
-- DROP NAMESPACE lightning.metastore.drug_synergy;
