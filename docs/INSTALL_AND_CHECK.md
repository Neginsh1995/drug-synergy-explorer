# Install and check

Six steps take a machine from a running Zetaris platform to a working dashboard; the agent follows. Each step
lists what to run and how to check it worked. Run commands from this project folder unless a
step says otherwise. `setup/check.sh` runs every check at once and changes nothing.

**Before you start**

| Need | Check |
|---|---|
| Zetaris platform installed and running in Docker | `docker ps` lists `zetaris-driver-1`, `zetaris-api-1`, `zetaris-ui-1`, `zetaris-postgres-1` |
| Java 11 or later | `/usr/libexec/java_home` prints a JDK path (macOS) |
| Python 3.10 or later | `python3 --version` |
| The hackathon data | Included in `data/Hackathon_data/`; run `setup/unpack_data.sh` once after cloning (it unpacks `Output_Prediction/Output.csv`). |
| The Zetaris getting-started repository (for its SQL runner) | It has `scripts/run_sql.py` |

Set up Python and settings once:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
cp .env.example .env.local
```

Fill in `.env.local`: the JDBC URL (`jdbc:zetaris:lightning@localhost:10000` for a local install),
your Zetaris login, and the full path to the JDBC driver JAR (`jdbc/ndp-jdbc-driver-*.jar` in the
platform folder). Keep `.env.local` private.

In the commands below, `RUNNER` is the getting-started repository's runner and `JAR` the driver:

```bash
RUNNER=/path/to/getting-started/scripts/run_sql.py; JAR=/path/to/zetaris-platform/jdbc/ndp-jdbc-driver-2.4.3.1-7eff043-driver.jar
```

The runner sends one statement at a time, keeps the multi-table `COMPILE USL` whole, and accepts
`--dry-run` to list the statements without sending them.

---

## Step 1. Copy the data folder into Zetaris's storage

**Run**

```bash
setup/load_source_files.sh            # uses data/Hackathon_data
```

The script empties the Docker volume `drug-synergy-data` (creating it if needed), copies the whole
folder into it with its layout (unpacking `Output.csv` first), and gives the files to the user the
Zetaris engine runs as (uid 1001). It prints the files it loaded: the four CSVs from the repository,
plus the model's feature files and train/test samples if they are in the folder.

**Check** the main files match the originals byte for byte:

```bash
docker run --rm -v drug-synergy-data:/data postgres:16-alpine sh -c 'cd /data && sha256sum Output_Prediction/Output.csv Cell_Drug_Annotation_Mapping/Drug_metadata.csv'
```

```bash
cd data/Hackathon_data && shasum -a 256 Output_Prediction/Output.csv Cell_Drug_Annotation_Mapping/Drug_metadata.csv
```

The two lists must be identical.

## Step 2. Mount the data into the Zetaris engine

Skip the restart when the volume is already mounted (an earlier install): the engine sees the new
files at once.

**Run**, from the Zetaris platform folder (the one with `docker-compose.yml`):

```bash
cp /path/to/drug-synergy-explorer/setup/docker-compose.override.yml . && docker compose up -d --no-deps driver
```

Docker Compose reads `docker-compose.override.yml` automatically. The engine restarts; JDBC is
unavailable for about a minute.

**Check** the engine sees the files and JDBC is back:

```bash
docker exec zetaris-driver-1 ls -R /home/zetaris/customer-data/shared/drug-synergy-data
```

```bash
nc -z localhost 10000 && echo "JDBC port open"
```

```bash
python3 "$RUNNER" --channel jdbc --jar "$JAR" -e "SELECT 1"
```

The last command prints `[1]`. Zetaris reads local files only below
`/home/zetaris/customer-data/shared`, which is why the volume is mounted there.

## Step 3. Register the source tables

**Run** `sql/01_source_tables.sql` (7 statements):

```bash
python3 "$RUNNER" --channel jdbc --jar "$JAR" sql/01_source_tables.sql
```

```sql
CREATE LIGHTNING DATABASE DRUG_SYNERGY_DATA DESCRIBE BY "Drug synergy hackathon data";
CREATE LIGHTNING FILESTORE TABLE predictions FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/drug-synergy-data/Output_Prediction/Output.csv", header "true", inferSchema "true", delimiter ",");
CREATE LIGHTNING FILESTORE TABLE drug_metadata FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/drug-synergy-data/Cell_Drug_Annotation_Mapping/Drug_metadata.csv", header "true", inferSchema "true", delimiter ",", quote '"', escape '"', multiLine "true");
CREATE LIGHTNING FILESTORE TABLE cell_lines_metadata FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/drug-synergy-data/Cell_Drug_Annotation_Mapping/cell_lines_metadata.csv", header "true", inferSchema "true", delimiter ",", quote '"', escape '"');
CREATE LIGHTNING FILESTORE TABLE measured_combinations FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/drug-synergy-data/Whole_Samples/DrugComb_V2_measured_combinations.csv", header "true", inferSchema "true", delimiter ",");
```

The drug and cell line files need `quote` and `escape` (and the drug file `multiLine`) because
their synonym, structure and mechanism fields contain commas.

**Check**: `SHOW LIGHTNING TABLES DRUG_SYNERGY_DATA` lists the 4 tables, and the row counts are:

| Table | Rows |
|---|---|
| `predictions` | 719,112 |
| `drug_metadata` | 3,139 |
| `cell_lines_metadata` | 2,320 |
| `measured_combinations` | 359,556 |

```sql
SELECT COUNT(*) FROM DRUG_SYNERGY_DATA.predictions
```

(and the same for each table).

Optional: `sql/01b_train_test_samples.sql` registers the model's train and test samples
(`lov_train` 300,642 rows, `lov_test` 58,914) if the files are in the data folder; nothing uses them.

## Step 4. Build the semantic layer

**Run** `sql/02_semantic_layer.sql` (17 statements):

```bash
python3 "$RUNNER" --channel jdbc --jar "$JAR" sql/02_semantic_layer.sql
```

What it does:

| Statements | Purpose |
|---|---|
| `CREATE NAMESPACE IF NOT EXISTS lightning.metastore` and `… lightning.metastore.drug_synergy` | Where the model lives |
| `COMPILE USL IF NOT EXISTS drug_synergy DEPLOY NAMESPACE lightning.metastore.drug_synergy DDL CREATE TABLE drugs (…); CREATE TABLE cell_lines (…); CREATE TABLE synergy_results (…); CREATE TABLE measured_combinations (…)` | Four tables with primary keys (`pubchem_cid`, `cell_line_id`, `result_id`, `block_id`) and foreign keys (`drug_1`, `drug_2` → `drugs`; `cell_line_id` → `cell_lines`); sent as one statement |
| `UPDATE USL … SET DESCRIPTION …` (5) | Descriptions for the model and each table |
| `ACTIVATE USL TABLE … AS SELECT … FROM DRUG_SYNERGY_DATA.…` (4) | Binds each table to its source; `drugs` adds the curated mechanism and target-gene columns; `synergy_results` builds `result_id` as `<drug_1>_<drug_2>_<cell_line>` |
| `LIST DQ USL …` and `RUN DQ TABLE …` (4) | Lists and runs the key checks |

**Check**: the `RUN DQ TABLE` results at the end of the run must show 0 invalid rows:

```
pubchem_cid   drugs                  Primary Key Constraint  3139    3139    0
cell_line_id  cell_lines             Primary Key Constraint  2320    2320    0
result_id     synergy_results        Primary Key Constraint  719112  719112  0
drug_1        synergy_results        Foreign Key Constraint  719112  719112  0
drug_2        synergy_results        Foreign Key Constraint  719112  719112  0
cell_line_id  synergy_results        Foreign Key Constraint  719112  719112  0
block_id      measured_combinations  Primary Key Constraint  359556  359556  0
drug_1        measured_combinations  Foreign Key Constraint  359556  359556  0
drug_2        measured_combinations  Foreign Key Constraint  359556  359556  0
cell_line_id  measured_combinations  Foreign Key Constraint  359556  359556  0
```

## Step 5. Check the data and the pipeline

**Run** `sql/03_checks.sql` (read-only):

```bash
python3 "$RUNNER" --channel jdbc --jar "$JAR" sql/03_checks.sql
```

Expected counts: `drugs` 3139, `cell_lines` 2320, `synergy_results` 719112,
`measured_combinations` 359556, then 10 sample rows.

**Run** the pipeline for one cell line:

```bash
.venv/bin/python app/pairs_app.py UACC62
```

Expected:

```
UACC62: skin (CCLE UACC62_SKIN, DepMap ACH-000425)
UACC62 (id 85): 4921927 drug pairs -> 10121 with predictions -> 905 synergy -> 432 with z_HSA >= 1
Saved …/results/most_promising_UACC62_PubChemCID.csv
```

The CSV has 433 lines (header plus 432 pairs), 33 columns, highest `z_HSA` first
(657237, 73013358, 85, …, 3.7410547…). It is byte-identical to the team's pandas filtering
script run on the same `Output.csv`.

**Run** all checks:

```bash
setup/check.sh
```

Every line reads `[PASS]` and the script ends with `All checks passed.`

## Step 6. Remove earlier copies (only when replacing an earlier setup)

Skip this step on a new machine. When the data was set up before under other names, remove the
old copies once steps 1 to 5 pass, so nothing reads stale data. `sql/99_remove_previous_objects.sql`
holds the statements with placeholders; fill in the earlier names, list them first with
`--dry-run`, then run:

```sql
REMOVE USL <usl> NAMESPACE lightning.metastore.<old_namespace>;
DROP NAMESPACE lightning.metastore.<old_namespace>;
DROP LIGHTNING DATABASE <OLD_DATABASE>
```

Then remove the old volume and its empty mount folder, from the platform folder:

```bash
docker exec -u 0 zetaris-driver-1 rmdir /home/zetaris/customer-data/shared/<old-folder>
```

```bash
docker volume rm <old-volume>
```

To reload the same names with new data instead, remove the semantic layer and the database
(`REMOVE USL drug_synergy NAMESPACE lightning.metastore.drug_synergy`, then
`DROP LIGHTNING DATABASE DRUG_SYNERGY_DATA`) and repeat steps 1, 3 and 4.

**Check** only the new objects remain:

```sql
SHOW LIGHTNING DATABASES
```

```sql
SHOW NAMESPACES OR TABLES IN lightning.metastore
```

Expected: `DRUG_SYNERGY_DATA` among the databases (next to Zetaris's samples) and one namespace,
`drug_synergy`. `docker volume ls` lists `drug-synergy-data` and not the old volume.

---

## Start the dashboard

```bash
.venv/bin/python app/pairs_app.py --serve
```

Set `HACKATHON_DATA_DIR` in `.env.local` to the hackathon data folder first: the dashboard reads the
model's modalities from it. Open http://127.0.0.1:8765/. The status under **Run pipeline** reads
`Zetaris · 170 cell lines with predictions in 16 tissues.` and the "Modalities used by the model" panel
lists 5 drug and 3 cell-line modalities. Choose **Urinary tract** and **647V**, then **Run pipeline**:
the funnels read 14, 8 and 2, the log shows each Zetaris query with a link to its plan, and the
clinician-ready overview lists two pairs.

The team's Explorer page is at http://127.0.0.1:8765/explorer. Enter `UACC62` and select **Find promising drug pairs**: after about 15 seconds the table shows
"Top 10 of 432 records for UACC62", Fludarabine + Y-39983 dihydrochloride 2/3 H2O first
(z_HSA 3.7411), and `results/most_promising_UACC62_PubChemCID.csv` is written. Select **View**,
then **Drug targets**, to see both drugs' target genes and the ones they share. Run `setup/check.sh`
while the server is up and it also checks the page server.

## The agent step

The agent reviews the shortlist against the literature with an LLM through Meterless Nightshift;
see the README's "Agent" section.

**Set up (once)**

```bash
node -v
```

```bash
(cd agent/synergy_agent && npm ci) && (cd agent/reference && npm ci)
```

```bash
(cd agent/synergy_agent && npm test)
```

The first prints a Node.js version (install the LTS from nodejs.org if missing); the last reports
39 tests passed. Install Meterless Nightshift, open it, and set up a provider or local model. Check
it answers (prints `200`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(cat "$HOME/Library/Application Support/ai.meterless.runtime/proxy-token")" http://127.0.0.1:8088/v1/models
```

**Mount the results folder.** `setup/docker-compose.override.yml` (step 2) also mounts this
project's `results/agent` folder, read-only, into the Zetaris engine. It assumes the platform
folder and this folder sit side by side; otherwise set `DRUG_SYNERGY_AGENT_RESULTS` to the full path
before `docker compose up -d --no-deps driver`. Check:

```bash
docker exec zetaris-driver-1 ls /home/zetaris/customer-data/shared/agent-results
```

**Run** for one cell line, small limits first:

```bash
./run_pipeline.sh UACC62 --examine 5 --keep 2
```

Expected: the shortlist counts, `Agent input …/results/agent/UACC62/agent_input.csv`,
`Nightshift OK.`, one line per pair examined (KEEP or REJECT and the reason), and the agent's files
in `results/agent/UACC62/`.

**Register the results in Zetaris** (once, after the first run; 1 statement plus a check):

```bash
python3 "$RUNNER" --channel jdbc --jar "$JAR" sql/04_agent_results.sql
```

```sql
CREATE LIGHTNING FILESTORE TABLE agent_ranked FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/agent-results/*/ranked.csv", header "true", inferSchema "false", delimiter ",", quote '"', escape '"', multiLine "true");
```

Later runs appear automatically: `run_pipeline.sh` ends with
`app/pairs_app.py --refresh-agent-results`, which prints the row count.

**All cell lines**

```bash
./run_pipeline.sh --all --examine 10 --keep 3 --skip-done
```

Runs every cell line with predictions (170). It checks Nightshift once before starting, refreshes
Zetaris after each cell line, logs to `results/agent/logs/`, and writes
`results/agent/run_summary.csv` (cell line, promising pairs, examined, kept, agent status). If
Nightshift stops answering, the run stops; rerun the same command (`--skip-done`) to continue.
To check the agent's setup without running anything: `agent/run_agent.sh --check`.

**Check** with `setup/check.sh`: the agent lines report Node.js, the packages, the agent's tests,
Nightshift, and the agent results in Zetaris. In the page, select **View** for a pair, then
**Pathways** and **Evidence**.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Invalid file path to access` in step 3 | The files are not under `/home/zetaris/customer-data/shared`: check step 2's mount path |
| `Input path does not exist` in step 3 | The volume does not hold that file: rerun step 1 with the right folder |
| `Can't reach the data server` on the page | The server is not running: start it as above |
| `Zetaris is not reachable` | The engine is down or restarting: `docker ps`, then wait for port 10000 |
| `Set ZETARIS_JDBC_JAR in .env.local` | Add the full path to the driver JAR in `.env.local` |
| `Unknown cell line` | The name is not in the cell line list; the input box suggests valid names |
| Results differ from a teammate's CSV | Different predictions file loaded; compare `Prediction_label_*` for a shared pair |
| `Agent project not found` | `agent/synergy_agent` is missing; restore it, or set `AGENT_DIR` |
| `Packages missing in …` | Run `npm ci` in `agent/synergy_agent` and `agent/reference` |
| Pathways and Evidence say "No agent result" | The agent has not run for that cell line, kept no pairs, or `sql/04` was not run |
| `No Nightshift token` | Open Nightshift once so it writes its token file, or set `METERLESS_RUNTIME_TOKEN` |
| `Nightshift not ready (HTTP …)` | Nightshift is closed or has no models: open it and check Setup > Providers/Local models |
