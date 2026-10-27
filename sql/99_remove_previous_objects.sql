-- =============================================================================
-- 99 Remove previous objects: only when replacing an earlier setup of this data
-- under other names (docs/INSTALL_AND_CHECK.md, step 6). Run after steps 1 to 5 pass.
-- Fill in the placeholders, list the statements with --dry-run, then run them.
-- These statements delete objects; the source CSV files are not touched.
-- =============================================================================

REMOVE USL <usl> NAMESPACE lightning.metastore.<old_namespace>;
DROP NAMESPACE lightning.metastore.<old_namespace>;
DROP LIGHTNING DATABASE <OLD_DATABASE>
