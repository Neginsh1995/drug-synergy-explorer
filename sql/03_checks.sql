-- 03 Checks: row counts and a sample join for lightning.metastore.drug_synergy.drug_synergy.
SHOW NAMESPACES OR TABLES IN lightning.metastore.drug_synergy;
SELECT COUNT(*) FROM lightning.metastore.drug_synergy.drug_synergy.drugs;
SELECT COUNT(*) FROM lightning.metastore.drug_synergy.drug_synergy.cell_lines;
SELECT COUNT(*) FROM lightning.metastore.drug_synergy.drug_synergy.synergy_results;
SELECT COUNT(*) FROM lightning.metastore.drug_synergy.drug_synergy.measured_combinations;
SELECT r.result_id, d1.drug_name AS drug_1_name, d2.drug_name AS drug_2_name, c.name AS cell_line, c.tissue, r.ground_truth_label_loewe, r.prediction_label_loewe, r.ground_truth_label_bliss, r.prediction_label_bliss, r.fold FROM lightning.metastore.drug_synergy.drug_synergy.synergy_results r JOIN lightning.metastore.drug_synergy.drug_synergy.drugs d1 ON r.drug_1 = d1.pubchem_cid JOIN lightning.metastore.drug_synergy.drug_synergy.drugs d2 ON r.drug_2 = d2.pubchem_cid JOIN lightning.metastore.drug_synergy.drug_synergy.cell_lines c ON r.cell_line_id = c.cell_line_id ORDER BY r.result_id LIMIT 10;
