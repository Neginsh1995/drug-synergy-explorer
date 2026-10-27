"""Most promising drug pairs for a cell line, from Zetaris.

For one cell line, Zetaris runs the whole pipeline:
  1. all drug pairs: every pair of two different drugs in the drug list, smaller PubChem CID
     first (RG2833 has no model features and is left out; so are pairs of one drug listed
     under two CIDs)
  2. predictions: the model's output for that cell line, the two drug orders averaged
  3. synergy: at least 3 of 4 metrics with prediction > 5 and, where measured, measured value > 6
  4. confidence: z_HSA = (Prediction_label_HSA - 5) / HSA_total_std >= 1, highest first
Every run saves all the promising pairs to results/most_promising_<CELL>_PubChemCID.csv,
in the same 33 columns and format as the team's pandas script.

  python pairs_app.py MCF7        # print the counts and save the CSV
  python pairs_app.py --serve     # the dashboard at http://127.0.0.1:8765/ (the Explorer at /explorer)
  python pairs_app.py MCF7 --agent-input   # also write the agent's input file
  python pairs_app.py --list-cell-lines    # the cell lines that have predictions

Settings come from the environment, or from .env.local in the project folder (another file
can be named with ZETARIS_ENV_FILE): ZETARIS_JDBC_URL, ZETARIS_USERNAME, ZETARIS_PASSWORD,
ZETARIS_JDBC_JAR and, optionally, DRUG_SYNERGY_USL. See .env.example.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DASHBOARD_PAGE = ROOT / "ui" / "SynergyTumor_Dashboard.html"  # the SynergyTumor Board dashboard, served at /
EXPLORER_PAGE = ROOT / "ui" / "Drug_Synergy_Explorer.html"     # the team's original Explorer, served at /explorer
RESULTS = ROOT / "results"
DRIVER_CLASS = "com.zetaris.lightning.jdbc.LightningDriver"


# --- Zetaris connection ---------------------------------------------------------


def load_env_file(path: str) -> None:
    """Load KEY=VALUE lines without overriding variables already set."""
    p = Path(path)
    if not p.is_file():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def find_java_home() -> str | None:
    candidates = [os.environ.get("JAVA_HOME")]
    try:
        out = subprocess.run(["/usr/libexec/java_home"], capture_output=True, text=True)
        if out.returncode == 0:
            candidates.append(out.stdout.strip())
    except OSError:
        pass
    for formula in ("openjdk@17", "openjdk@21", "openjdk"):  # Homebrew JDKs
        for prefix in ("/opt/homebrew", "/usr/local"):
            candidates.append(f"{prefix}/opt/{formula}/libexec/openjdk.jdk/Contents/Home")
    return next((h for h in candidates if h and (Path(h) / "bin" / "java").is_file()), None)


class Zetaris:
    """One lazily opened JDBC connection, shared and serialised with a lock."""

    def __init__(self) -> None:
        self._conn = None
        self._lock = threading.Lock()

    def _connect(self):
        jar = os.environ.get("ZETARIS_JDBC_JAR", "")
        if not Path(jar).is_file():
            raise RuntimeError(f"Set ZETARIS_JDBC_JAR in .env.local to the Zetaris JDBC driver JAR (now {jar!r})")
        home = find_java_home()
        if not home:
            raise RuntimeError("No Java found; set JAVA_HOME")
        os.environ["JAVA_HOME"] = home
        import jaydebeapi

        return jaydebeapi.connect(
            DRIVER_CLASS,
            os.environ.get("ZETARIS_JDBC_URL", "jdbc:zetaris:lightning@localhost:10000"),
            [os.environ.get("ZETARIS_USERNAME", ""), os.environ.get("ZETARIS_PASSWORD", "")],
            jar,
        )

    def query(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        # Read-only: SELECT queries, plus clearing the cached view of a file table (no data change).
        assert sql.lstrip().upper().startswith(("SELECT", "WITH", "UNCACHE LIGHTNING FILESTORE TABLE")), \
            "read-only: SELECT only"
        with self._lock:
            for attempt in (1, 2):
                try:
                    if self._conn is None:
                        self._conn = self._connect()
                    cur = self._conn.cursor()
                    try:
                        cur.execute(sql, params)
                        if not cur.description:
                            return []
                        cols = [d[0] for d in cur.description]
                        return [dict(zip(cols, map(plain, row))) for row in cur.fetchall()]
                    finally:
                        cur.close()
                except Exception as e:  # jaydebeapi raises Java exceptions
                    self._conn = None  # reconnect once, e.g. after Zetaris restarts
                    if attempt == 2:
                        raise RuntimeError(f"Zetaris query failed: {str(e)[:300]}") from None
        return []


def plain(v: Any) -> Any:
    return v if v is None or isinstance(v, (bool, int, float)) else str(v)


# --- the pipeline query -----------------------------------------------------------

load_env_file(os.environ.get("ZETARIS_ENV_FILE", str(ROOT / ".env.local")))
USL = os.environ.get("DRUG_SYNERGY_USL") or "lightning.metastore.drug_synergy.drug_synergy"

METRICS = {"loewe": "Loewe", "bliss": "Bliss", "hsa": "HSA", "zip": "Zip"}
NO_FEATURE_CIDS = "56654642"  # RG2833
# Output columns in Output.csv's order: Zetaris column -> original column name.
PAIR_COLUMNS = {
    **{f"{kind}_label_{m}": f"{title}_label_{t}"
       for m, t in METRICS.items() for kind, title in (("ground_truth", "Ground_Truth"), ("prediction", "Prediction"))},
    **{f"{m}_{stat}": f"{t}_{stat}"
       for m, t in METRICS.items() for stat in ("total_std", "aleatoric_std", "epistemic_std", "pi_lower", "pi_upper")},
}
SYNERGY_COUNT = " + ".join(
    f"CASE WHEN p.`Prediction_label_{t}` > 5 "
    f"AND (p.`Ground_Truth_label_{t}` IS NULL OR p.`Ground_Truth_label_{t}` > 6) THEN 1 ELSE 0 END"
    for t in METRICS.values()
)
Z_HSA = "(`Prediction_label_HSA` - 5) / `HSA_total_std`"
PIPELINE = (
    "WITH all_pairs AS ("
    f"SELECT a.pubchem_cid AS drug_1, b.pubchem_cid AS drug_2 FROM {USL}.drugs a JOIN {USL}.drugs b "
    "ON a.pubchem_cid < b.pubchem_cid AND lower(a.drug_name) <> lower(b.drug_name) "
    f"WHERE a.pubchem_cid NOT IN ({NO_FEATURE_CIDS}) AND b.pubchem_cid NOT IN ({NO_FEATURE_CIDS})), "
    "predictions AS ("
    "SELECT least(drug_1, drug_2) AS drug_1, greatest(drug_1, drug_2) AS drug_2, cell_line_id AS cell_line, "
    + ", ".join(f"AVG({col}) AS `{name}`" for col, name in PAIR_COLUMNS.items())
    + f" FROM {USL}.synergy_results WHERE cell_line_id = ? "
    "GROUP BY least(drug_1, drug_2), greatest(drug_1, drug_2), cell_line_id), "
    f"flagged AS (SELECT p.*, {SYNERGY_COUNT} AS n_synergy_metrics FROM all_pairs a "
    "JOIN predictions p ON a.drug_1 = p.drug_1 AND a.drug_2 = p.drug_2) "
)
# The team's output format: PubChem CIDs, the cell line id, the averaged scores, label, z_HSA.
CSV_COLUMNS = ["drug_1", "drug_2", "cell_line", *PAIR_COLUMNS.values(), "label", "z_HSA"]
db = Zetaris()


CELL_COLUMNS = "cell_line_id, name, tissue, ccle_name, disease_id, depmap_id, cellosaurus_accession"


def annotate(cell: dict[str, Any]) -> dict[str, Any]:
    """Add a readable tissue. The tissue column keeps only its first word ("Large"), so read
    it from the CCLE name instead: HCT116_LARGE_INTESTINE -> "large intestine"."""
    ccle = cell.get("ccle_name") or ""
    full = ccle.split("_", 1)[1].replace("_", " ").lower() if "_" in ccle else ""
    return {**cell, "tissue": full or (cell.get("tissue") or "").lower() or None}


_cell_cache: dict[str, dict[str, Any]] = {}


def find_cell_line(name: str) -> dict[str, Any] | None:
    """Cell line by exact name, then case-insensitively, with its tissue annotation. Found cell lines
    are remembered (they do not change), so the pages' progress checks do not query Zetaris each time."""
    key = name.strip().lower()
    if key in _cell_cache:
        return _cell_cache[key]
    for sql in (f"SELECT {CELL_COLUMNS} FROM {USL}.cell_lines WHERE name = ?",
                f"SELECT {CELL_COLUMNS} FROM {USL}.cell_lines WHERE lower(name) = lower(?)"):
        rows = db.query(sql, (name.strip(),))
        if rows:
            _cell_cache[key] = annotate(rows[0])
            return _cell_cache[key]
    return None


_cell_lines_cache: list[dict[str, Any]] | None = None


def cell_lines_with_predictions() -> list[dict[str, Any]]:
    """Name and tissue of every cell line the model has predictions for (cached)."""
    global _cell_lines_cache
    if _cell_lines_cache is None:
        rows = db.query(
            f"SELECT {CELL_COLUMNS} FROM {USL}.cell_lines WHERE cell_line_id IN "
            f"(SELECT DISTINCT cell_line_id FROM {USL}.synergy_results) ORDER BY name")
        _cell_lines_cache = [{k: c[k] for k in ("name", "tissue")} for c in map(annotate, rows)]
    return _cell_lines_cache


def promising_pairs(cell_line: str) -> dict[str, Any]:
    """All promising pairs for one cell line name, ranked, with the counts at each stage."""
    cell = find_cell_line(cell_line)
    if cell is None:
        raise ValueError(f"Unknown cell line {cell_line!r}; use a name from the cell line list, e.g. 'UACC62' or 'HCT116'")
    cid = int(cell["cell_line_id"])
    started = time.monotonic()
    counts = db.query(
        PIPELINE + "SELECT (SELECT COUNT(*) FROM all_pairs) AS all_pairs, COUNT(*) AS with_predictions, "
        "SUM(CASE WHEN n_synergy_metrics >= 3 THEN 1 ELSE 0 END) AS synergy, "
        f"SUM(CASE WHEN n_synergy_metrics >= 3 AND {Z_HSA} >= 1 THEN 1 ELSE 0 END) AS promising FROM flagged",
        (cid,),
    )[0]
    columns = ", ".join(f"f.`{name}`" for name in PAIR_COLUMNS.values())
    rows = db.query(
        PIPELINE + f"SELECT f.drug_1, d1.drug_name AS drug_1_name, f.drug_2, d2.drug_name AS drug_2_name, "
        f"f.cell_line, {columns}, 'synergy' AS label, {Z_HSA} AS z_HSA FROM flagged f "
        f"LEFT JOIN {USL}.drugs d1 ON f.drug_1 = d1.pubchem_cid "
        f"LEFT JOIN {USL}.drugs d2 ON f.drug_2 = d2.pubchem_cid "
        f"WHERE f.n_synergy_metrics >= 3 AND {Z_HSA} >= 1 ORDER BY z_HSA DESC",
        (cid,),
    )
    # what Zetaris did, for the page's Zetaris line: time for both pipeline queries, and where to see their plans
    zetaris = {"seconds": round(time.monotonic() - started, 1), "queries": 2,
               "query_plans": QUERY_UI + "/SQL/", "plans": latest_pipeline_queries(2)}
    return {"cell_line": cell["name"], "cell_line_id": cid, "annotation": cell,
            "counts": {k: int(v or 0) for k, v in counts.items()}, "pairs": rows, "zetaris": zetaris}


QUERY_UI = os.environ.get("ZETARIS_QUERY_UI", "http://localhost:4040").rstrip("/").removesuffix("/SQL")


def latest_pipeline_queries(n: int) -> list[dict[str, Any]]:
    """The Zetaris engine's ids for the last n pipeline queries (from its query monitor at port 4040), so
    the page can link straight to each query's plan. Empty if the monitor is not reachable."""
    from urllib.request import urlopen
    try:
        with urlopen(f"{QUERY_UI}/api/v1/applications", timeout=3) as r:
            app_id = json.load(r)[0]["id"]
        with urlopen(f"{QUERY_UI}/api/v1/applications/{app_id}/sql?details=false&offset=0&length=1000", timeout=3) as r:
            runs = [q for q in json.load(r) if str(q.get("description", "")).startswith("WITH all_pairs")]
    except Exception:
        return []
    return [{"id": q["id"], "seconds": round(q.get("duration", 0) / 1000, 1),
             "url": f"{QUERY_UI}/SQL/execution/?id={q['id']}"} for q in runs[-n:]]


DRUG_COLUMNS = "pubchem_cid, drug_name, curated_moa_target_genes_chembl, curated_target_genes_repurposinghub"


def drug_annotations(cids: list[int]) -> dict[int, dict[str, Any]]:
    """Curated target genes for the given drugs, keyed by PubChem CID."""
    if not cids:
        return {}
    placeholders = ", ".join("?" for _ in cids)
    rows = db.query(f"SELECT {DRUG_COLUMNS} FROM {USL}.drugs WHERE pubchem_cid IN ({placeholders})",
                    tuple(int(c) for c in cids))
    return {int(r["pubchem_cid"]): r for r in rows}


def save_csv(result: dict[str, Any]) -> Path:
    """Write every promising pair to results/most_promising_<CELL>_PubChemCID.csv."""
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / f"most_promising_{result['cell_line']}_PubChemCID.csv"
    with path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_COLUMNS)
        writer.writerows([row[c] for c in CSV_COLUMNS] for row in result["pairs"])
    return path


AGENT_COLUMNS = ["cell_line_name", "tissue", "cancer_type"]
AGENT_TABLE = "DRUG_SYNERGY_DATA.agent_ranked"  # the agent's ranked.csv files, registered by sql/04
EVIDENCE_COLUMNS = ("drug1_pubchem_cid, drug2_pubchem_cid, cell_line, rank, score, confidence, evidence_class, "
                    "direct_experimental_synergy, cell_line_specific_synergy, cell_line_evidence_level, "
                    "synergy_method, cancer_pathway_or_phenotype, mechanistic_rationale, evidence_summary, "
                    "negative_or_contradictory_evidence, cell_line_model_limitations, verified_pmids, "
                    "verified_dois, rounds_used, unresolved_issues, final_status")


def agent_evidence(cell_line_id: int) -> dict[str, dict[str, Any]]:
    """The agent's pathway and evidence results for one cell line, keyed by "<smaller CID>_<larger CID>".
    Empty when the agent has not run yet (no results table or no files)."""
    try:
        rows = db.query(f"SELECT {EVIDENCE_COLUMNS} FROM {AGENT_TABLE} WHERE cell_line = ?", (str(cell_line_id),))
    except RuntimeError:
        return {}
    out = {}
    for r in rows:
        try:
            a, b = sorted((int(float(r["drug1_pubchem_cid"])), int(float(r["drug2_pubchem_cid"]))))
        except (TypeError, ValueError):
            continue
        out[f"{a}_{b}"] = r
    return out


def refresh_agent_results() -> str:
    """Make Zetaris re-read the agent's result files after a run."""
    try:
        db.query(f"UNCACHE LIGHTNING FILESTORE TABLE agent_ranked FROM DRUG_SYNERGY_DATA")
        n = db.query(f"SELECT COUNT(*) AS n FROM {AGENT_TABLE}")[0]["n"]
        return f"Zetaris agent results refreshed: {n} rows in {AGENT_TABLE}"
    except RuntimeError as e:
        return (f"Agent results not in Zetaris yet ({str(e)[:120]}). After the first agent run, register them "
                f"with sql/04_agent_results.sql (see docs/INSTALL_AND_CHECK.md).")


def save_agent_input(result: dict[str, Any]) -> Path:
    """Write the agent's input: the shortlist plus the cell line's name, tissue and cancer type on
    every row (the agent takes the cell line from each row, never from a file name)."""
    a = result["annotation"]
    name, tissue = a["name"], a.get("tissue") or ""
    extra = [name, tissue, f"{tissue} cancer" if tissue else ""]
    path = RESULTS / "agent" / name / "agent_input.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_COLUMNS + AGENT_COLUMNS)
        writer.writerows([row[c] for c in CSV_COLUMNS] + extra for row in result["pairs"])
    return path


# --- the agent, started from the page --------------------------------------------------
# When a page runs a cell line that has no agent results yet, the server runs `./run_pipeline.sh <CELL>`
# in the background (Zetaris shortlist, the agent through Nightshift, Zetaris refresh), unless it
# already finished or is running. One cell line runs at a time; others wait in a queue. Its output
# goes to results/agent/<CELL>/agent_run.log, which the dashboard streams (/agent/log?cell_line=&from=);
# /agent/start?cell_line= starts it and /agent?cell_line= reports progress and, when done, the results.
# Settings: AGENT_ON_SUBMIT ("1" on, "0" off) and the agent's own limits (MAX_EXAMINE, TARGET_KEEP).

AGENT_SCRIPT = ROOT / "agent" / "run_agent.sh"
PIPELINE_SCRIPT = ROOT / "run_pipeline.sh"
FINAL_STATUSES = {"target_reached", "stopped_max_examined", "stopped_candidates_exhausted"}


def agent_dir(name: str) -> Path:
    return RESULTS / "agent" / name


def read_progress(name: str) -> dict[str, Any]:
    try:
        return json.loads((agent_dir(name) / "progress.json").read_text())
    except (OSError, ValueError):
        return {}


def screened_decisions(name: str) -> dict[str, dict[str, str]]:
    """The agent's decision for every pair it examined (screened.csv), keyed by the pair's rank
    in the shortlist: the agent's pair id "row N" is the Nth row of agent_input.csv."""
    out = {}
    try:
        with (agent_dir(name) / "screened.csv").open(newline="") as f:
            for r in csv.DictReader(f):
                key = (r.get("pair_id") or "").removeprefix("row ").strip()
                out[key] = {"decision": r.get("decision", ""), "reason": r.get("reason", ""),
                            "evidence_class": r.get("evidence_class", "")}
    except OSError:
        pass
    return out


class AgentRunner:
    """Runs the agent for one cell line at a time, in a background thread."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.queue: list[str] = []
        self.running: str | None = None
        self.errors: dict[str, str] = {}
        self.worker: threading.Thread | None = None

    def enabled(self) -> bool:
        return os.environ.get("AGENT_ON_SUBMIT", "1") != "0"

    def state(self, name: str) -> str:
        with self.lock:
            if self.running == name:
                return "running"
            if name in self.queue:
                return "queued"
            if name in self.errors:
                return "failed"
        if read_progress(name).get("status") in FINAL_STATUSES:
            return "done"
        return "not_started"

    def start(self, result: dict[str, Any]) -> None:
        """Queue the pipeline for this cell line unless it is done, running or queued."""
        if result["pairs"]:
            self.start_name(result["annotation"]["name"])

    def start_name(self, name: str) -> bool:
        """Queue `run_pipeline.sh <name>` (Zetaris shortlist, agent through Nightshift, Zetaris refresh)."""
        if not self.enabled() or self.state(name) in ("done", "running", "queued"):
            return False
        with self.lock:
            self.errors.pop(name, None)
            self.queue.append(name)
            if not (self.worker and self.worker.is_alive()):
                self.worker = threading.Thread(target=self._work, daemon=True)
                self.worker.start()
        return True

    def _work(self) -> None:
        while True:
            with self.lock:
                if not self.queue:
                    self.running = None
                    return
                name = self.running = self.queue.pop(0)
            folder = agent_dir(name)
            folder.mkdir(parents=True, exist_ok=True)
            try:
                # the same command as on the command line: ./run_pipeline.sh <CELL> (limits from .env.local)
                with (folder / "agent_run.log").open("w") as log:
                    rc = subprocess.run([str(PIPELINE_SCRIPT), name], cwd=str(ROOT),
                                        stdout=log, stderr=subprocess.STDOUT, env=dict(os.environ)).returncode
            except OSError as e:
                rc, log_error = 1, str(e)
            else:
                log_error = ""
            if rc == 0:
                print(f"agent finished for {name}; {refresh_agent_results()}", file=sys.stderr)
            else:
                msg = {3: "Nightshift is not reachable"}.get(rc, log_error or f"the agent stopped with an error (code {rc})")
                with self.lock:
                    self.errors[name] = f"{msg}; see results/agent/{name}/agent_run.log"
                print(f"agent failed for {name}: {self.errors[name]}", file=sys.stderr)

    def status(self, name: str) -> dict[str, Any]:
        prog = read_progress(name)
        state = self.state(name)
        out = {"state": state, "enabled": self.enabled(),
               # a finished run records the count as pairs_processed, a running one as examined
               "examined": prog.get("examined", prog.get("pairs_processed", 0)) if state != "not_started" else 0,
               "kept": prog.get("kept", 0) if state != "not_started" else 0,
               "max_examine": (prog.get("selection") or {}).get("max_examine")
                              or int(os.environ.get("MAX_EXAMINE", "40")),
               "decisions": screened_decisions(name) if state == "done" else {}}
        with self.lock:
            if state == "failed":
                out["error"] = self.errors.get(name, "")
            if state == "queued":
                out["position"] = self.queue.index(name) + 1
        return out


agent_runner = AgentRunner()


# --- the UI server ------------------------------------------------------------------


def serve(port: int) -> None:
    """The Explorer UI at / and its data at /pairs?cell_line=<name>&limit=<rows>."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urlparse(self.path)
            if url.path in ("/", "/index.html", "/dashboard"):
                return self.send(200, DASHBOARD_PAGE.read_bytes(), "text/html; charset=utf-8")
            if url.path in ("/explorer", "/explorer.html"):
                return self.send(200, EXPLORER_PAGE.read_bytes(), "text/html; charset=utf-8")
            if url.path.startswith("/stage/") or url.path == "/modalities":
                # the dashboard's per-stage Zetaris queries and the modalities read from the files
                import dashboard
                query = parse_qs(url.query)
                arg = lambda k: query.get(k, [""])[0].strip()
                try:
                    if url.path == "/modalities":
                        return self.reply(200, dashboard.modalities_summary(arg("drug1"), arg("drug2"), arg("cell")))
                    stage = url.path.removeprefix("/stage/")
                    if stage not in ("predictions", "synergy", "uncertainty", "agent"):
                        return self.reply(404, {"error": f"unknown stage {stage}"})
                    if not arg("cell_line"):
                        return self.reply(400, {"error": "Choose a cell line."})
                    return self.reply(200, dashboard.run_stage(stage, arg("cell_line")))
                except ValueError as e:
                    return self.reply(404, {"error": str(e)})
                except FileNotFoundError as e:
                    return self.reply(404, {"error": str(e)})
                except RuntimeError as e:
                    return self.reply(502, {"error": f"Zetaris is not reachable: {e}"})
            if url.path == "/cell_lines":
                try:
                    return self.reply(200, {"cell_lines": cell_lines_with_predictions()})
                except RuntimeError as e:
                    return self.reply(502, {"error": f"Zetaris is not reachable: {e}"})
            if url.path in ("/agent/start", "/agent/log"):
                cell = parse_qs(url.query).get("cell_line", [""])[0].strip()
                try:
                    found = find_cell_line(cell) if cell else None
                except RuntimeError as e:
                    return self.reply(502, {"error": f"Zetaris is not reachable: {e}"})
                if not found:
                    return self.reply(404, {"error": f"Unknown cell line: {cell}"})
                name = found["name"]
                if url.path == "/agent/start":
                    started = agent_runner.start_name(name)
                    return self.reply(200, {"started": started, "command": f"./run_pipeline.sh {name}",
                                            **agent_runner.status(name)})
                start = int(parse_qs(url.query).get("from", ["0"])[0] or 0)
                path = agent_dir(name) / "agent_run.log"
                lines = path.read_text(errors="replace").splitlines() if path.exists() else []
                return self.reply(200, {"lines": lines[start:], "next": len(lines), "state": agent_runner.state(name)})
            if url.path == "/agent":
                # progress of the agent for one cell line, and its results once it is done
                cell = parse_qs(url.query).get("cell_line", [""])[0].strip()
                try:
                    found = find_cell_line(cell) if cell else None
                except RuntimeError as e:
                    return self.reply(502, {"error": f"Zetaris is not reachable: {e}"})
                if not found:
                    return self.reply(404, {"error": f"Unknown cell line: {cell}"})
                name = found["name"]
                status = agent_runner.status(name)
                try:
                    evidence = agent_evidence(int(found["cell_line_id"])) if status["state"] == "done" else {}
                except RuntimeError:
                    evidence = {}
                return self.reply(200, {**status, "evidence": evidence})
            if url.path != "/pairs":
                return self.reply(404, {"error": "not found; the UI is at / and the data at /pairs?cell_line=<name>"})
            query = parse_qs(url.query)
            cell = query.get("cell_line", [""])[0].strip()
            if not cell:
                return self.reply(400, {"error": "Enter a cell line, e.g. MCF7."})
            try:
                result = promising_pairs(cell)
                saved = save_csv(result)
                limit = int(query["limit"][0]) if "limit" in query else None
                pairs = result["pairs"][:limit] if limit else result["pairs"]
                cids = sorted({int(p[k]) for p in pairs for k in ("drug_1", "drug_2")})
                evidence = agent_evidence(result["cell_line_id"])
                shown = {k: v for p in pairs for k in ["_".join(map(str, sorted((int(p["drug_1"]), int(p["drug_2"])))))]
                         if (v := evidence.get(k))}
                agent_runner.start(result)
                self.reply(200, {**result, "pairs": pairs, "drugs": drug_annotations(cids), "evidence": shown,
                                 "agent": agent_runner.status(result["annotation"]["name"]),
                                 "saved_csv": str(saved.relative_to(ROOT))})
            except ValueError as e:
                self.reply(404, {"error": str(e)})
            except RuntimeError as e:
                self.reply(502, {"error": f"Zetaris is not reachable: {e}"})

        def reply(self, status: int, body: dict) -> None:
            self.send(status, json.dumps(body, default=str).encode(), "application/json")

        def send(self, status: int, data: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", "*")  # lets the page work when opened as a file
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Explorer UI: http://127.0.0.1:{port}/  (Ctrl+C to stop)", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("cell_line", nargs="?", help="cell line name, e.g. MCF7")
    p.add_argument("--serve", action="store_true", help="serve the Explorer UI instead")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--agent-input", action="store_true",
                   help="also write results/agent/<CELL>/agent_input.csv for the agent")
    p.add_argument("--list-cell-lines", action="store_true", help="print the cell lines that have predictions")
    p.add_argument("--refresh-agent-results", action="store_true",
                   help="make Zetaris re-read the agent's result files after a run")
    args = p.parse_args()
    if args.refresh_agent_results:
        print(refresh_agent_results())
    elif args.list_cell_lines:
        print("\n".join(c["name"] for c in cell_lines_with_predictions()))
    elif args.serve:
        serve(args.port)
    elif not args.cell_line:
        p.error("give a cell line name, or --serve")
    else:
        try:
            result = promising_pairs(args.cell_line)
        except ValueError as e:
            sys.exit(str(e))
        n = result["counts"]
        a = result["annotation"]
        print(f"{a['name']}: {a['tissue']} (CCLE {a['ccle_name']}, DepMap {a['depmap_id']})")
        print(f"{result['cell_line']} (id {result['cell_line_id']}): {n['all_pairs']} drug pairs -> "
              f"{n['with_predictions']} with predictions -> {n['synergy']} synergy -> "
              f"{n['promising']} with z_HSA >= 1")
        print(f"Saved {save_csv(result).relative_to(ROOT)}")
        if args.agent_input:
            print(f"Agent input {save_agent_input(result).relative_to(ROOT)}")
