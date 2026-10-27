"""Back end for the SynergyTumor Board dashboard (ui/SynergyTumor_Dashboard.html, served at /dashboard).

Each pipeline stage is its own Zetaris query, so the page can show the stage running, the SQL it
sent, the rows it read and a link to the query's plan:
  /stage/predictions?cell_line=  all drug pairs and the model's predictions for the cell line
  /stage/synergy?cell_line=      prediction filter: at least 3 of 4 synergy metrics predicted > 5
  /stage/uncertainty?cell_line=  uncertainty filter: z_HSA = (predicted HSA - 5) / HSA total std >= 1
  /stage/agent?cell_line=        the literature agent's review (DRUG_SYNERGY_DATA.agent_ranked)
  /modalities[?drug1=&drug2=&cell=]  the model's input modalities, read from the hackathon files

Modalities are not assumed: every file under the hackathon data folder's *Modalities folders is
read, and whether it describes drugs or cell lines is decided by matching its ids against the drug
and cell line ids in Zetaris (a folder name is not trusted: gene_expression_data_lenient.json sits
in Drug_Modalities but is keyed by cell line). The folder is HACKATHON_DATA_DIR (.env.local).
"""

from __future__ import annotations

import csv
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import pairs_app as app

# --- one Zetaris query per stage -------------------------------------------------------------------

PAIR_SELECT = (
    "SELECT f.drug_1, d1.drug_name AS drug_1_name, f.drug_2, d2.drug_name AS drug_2_name, "
    + ", ".join(f"f.`{t}`" for t in app.PAIR_COLUMNS.values())
    + f", f.n_synergy_metrics, {app.Z_HSA} AS z_HSA FROM flagged f "
    f"LEFT JOIN {app.USL}.drugs d1 ON f.drug_1 = d1.pubchem_cid "
    f"LEFT JOIN {app.USL}.drugs d2 ON f.drug_2 = d2.pubchem_cid "
)
STAGE_SQL = {
    "predictions": "SELECT (SELECT COUNT(*) FROM all_pairs) AS all_pairs, COUNT(*) AS with_predictions FROM flagged",
    "synergy": PAIR_SELECT + "WHERE f.n_synergy_metrics >= 3 ORDER BY z_HSA DESC",
    "uncertainty": PAIR_SELECT + f"WHERE f.n_synergy_metrics >= 3 AND {app.Z_HSA} >= 1 ORDER BY z_HSA DESC",
}


def readable_sql(sql: str, cell_line_id: int) -> str:
    """The SQL as sent, with the cell line id filled in and a line break before each clause."""
    s = sql.replace("?", str(cell_line_id))
    s = re.sub(r"\s+(predictions AS \(|flagged AS \(|SELECT |FROM |LEFT JOIN |JOIN |WHERE |GROUP BY |ORDER BY )",
               lambda m: "\n" + m.group(1), s)
    return s.strip()


def run_stage(stage: str, cell_line: str) -> dict[str, Any]:
    cell = app.find_cell_line(cell_line)
    if cell is None:
        raise ValueError(f"Unknown cell line {cell_line!r}")
    cid = int(cell["cell_line_id"])
    if stage == "agent":
        return agent_stage(cell)
    sql = app.PIPELINE + STAGE_SQL[stage]
    started = time.monotonic()
    rows = app.db.query(sql, (cid,))
    out = {"stage": stage, "cell_line": cell["name"], "cell_line_id": cid, "annotation": cell,
           "sql": readable_sql(sql, cid), "rows_retrieved": len(rows),
           "seconds": round(time.monotonic() - started, 1), "plan": app.latest_pipeline_queries(1)}
    if stage == "predictions":
        out["counts"] = {k: int(v or 0) for k, v in rows[0].items()}
    else:
        out["pairs"] = rows
        if stage == "uncertainty":
            cids = sorted({int(p[k]) for p in rows[:50] for k in ("drug_1", "drug_2")})
            out["drugs"] = app.drug_annotations(cids)
    return out


def agent_stage(cell: dict[str, Any]) -> dict[str, Any]:
    """The literature agent's results for the cell line: kept pairs from Zetaris, and every decision
    and the run status from the agent's own files (screened.csv, progress.json) when they exist."""
    cid = int(cell["cell_line_id"])
    sql = f"SELECT * FROM {app.AGENT_TABLE} WHERE cell_line = ?"
    started = time.monotonic()
    try:
        kept = app.db.query(sql, (str(cid),))
    except RuntimeError:
        kept = []
    folder = app.agent_dir(cell["name"])
    screened = []
    if (folder / "screened.csv").exists():
        with (folder / "screened.csv").open(newline="") as f:
            screened = list(csv.DictReader(f))
    progress = app.read_progress(cell["name"])
    return {"stage": "agent", "cell_line": cell["name"], "cell_line_id": cid,
            "sql": readable_sql(sql, cid).replace("= " + str(cid), f"= '{cid}'"),
            "rows_retrieved": len(kept), "seconds": round(time.monotonic() - started, 1),
            "kept": kept, "screened": screened,
            "progress": {k: progress.get(k) for k in ("status", "examined", "pairs_processed", "kept", "stop_reason")},
            "model_route": (progress.get("provider") or {}).get("model") or "meterless/auto",
            "engine": "Meterless Markovian engine, Proposer and Critic through Nightshift"}


# --- modalities, read from the files ---------------------------------------------------------------

_data = Path(os.path.expanduser(os.environ.get("HACKATHON_DATA_DIR", "data/Hackathon_data")))
DATA_DIR = _data if _data.is_absolute() else app.ROOT / _data  # relative paths: from the project folder
CACHE = app.RESULTS / "modalities_cache.json"
# Display names only; which modalities exist, and whether each describes drugs or cell lines, is read
# from the files.
# Modalities are identified by their file name (the files' inner keys are not shown).
PRETTY = {"drug_chemberta": "ChemBERTa", "drug_rdkit": "RDKit fingerprint", "Genetic_Signature": "Genetic signature",
          "Morphology": "Morphology", "missing_Bioassay": "Bioassay",
          "gene_expression_data_lenient": "Gene expression (lenient)",
          "BROAD_DepMap_gene_expression_Drug_Targets": "Gene expression (drug targets)",
          "CELL_CRSPR": "CRISPR", "pathway_dimensions_lenient": "Pathway dimensions (lenient)"}
_modalities: dict[str, Any] | None = None


def _scan() -> dict[str, Any]:
    drug_ids = {str(int(r["pubchem_cid"])) for r in app.db.query(f"SELECT pubchem_cid FROM {app.USL}.drugs")}
    cell_ids = {str(int(r["cell_line_id"])) for r in app.db.query(f"SELECT cell_line_id FROM {app.USL}.cell_lines")}
    mods = []
    for path in sorted(DATA_DIR.glob("*Modalities*/*")):
        entry = {"file": f"{path.parent.name}/{path.name}", "folder": path.parent.name}
        if path.suffix == ".json":
            data = json.loads(path.read_text())
            keys = [str(k) for k in data]
            first = data[keys[0]]
            name = path.stem
            vec = next(iter(first.values())) if isinstance(first, dict) and len(first) == 1 else first
            n_drug, n_cell = len(drug_ids.intersection(keys)), len(cell_ids.intersection(keys))
            entity = "drug" if n_drug > n_cell else "cell_line" if n_cell else "unknown"
            entry.update(name=name, entries=len(keys), features=len(vec) if isinstance(vec, list) else None,
                         entity=entity, matched=max(n_drug, n_cell), keys=keys)
        elif path.suffix == ".csv":
            with path.open(newline="") as f:
                reader = csv.reader(f)
                header = next(reader)
                n = 1 + sum(1 for _ in reader)
            entry.update(name=path.stem, entries=n, features=len(header), entity="supporting", matched=0, keys=[])
        else:
            continue
        entry["label"] = PRETTY.get(entry["name"], entry["name"].replace("_", " "))
        mods.append(entry)
    return {"data_dir": _short(DATA_DIR), "mtimes": _mtimes(), "modalities": mods}


def _short(path: Path) -> str:
    """A path with the home folder shown as ~ (keeps the user's name out of the cache and responses)."""
    home = str(Path.home())
    return "~" + str(path)[len(home):] if str(path).startswith(home) else str(path)


def _mtimes() -> dict[str, float]:
    return {f"{p.parent.name}/{p.name}": p.stat().st_mtime for p in sorted(DATA_DIR.glob("*Modalities*/*"))}


def modalities() -> dict[str, Any]:
    """Every modality file, scanned once and cached in results/modalities_cache.json (rescanned when a
    file changes)."""
    global _modalities
    if _modalities is None and CACHE.exists():
        cached = json.loads(CACHE.read_text())
        if cached.get("mtimes") == _mtimes():
            _modalities = cached
    if _modalities is None and not list(DATA_DIR.glob("*Modalities*/*")):
        # the modality files are part of the full data download, not the repository (data/README.md)
        return {"data_dir": _short(DATA_DIR), "modalities": [],
                "note": "Modality files not present: add the full data download (data/README.md)."}
    if _modalities is None:
        if not DATA_DIR.is_dir():
            raise FileNotFoundError(f"Hackathon data folder not found: {DATA_DIR} (set HACKATHON_DATA_DIR in .env.local)")
        _modalities = _scan()
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(_modalities))
    return _modalities


def modalities_summary(drug1: str = "", drug2: str = "", cell: str = "") -> dict[str, Any]:
    """The modalities without their id lists; with ids given, whether each one has data for them."""
    want = {"drug1": drug1, "drug2": drug2, "cell": cell}
    out = []
    for m in modalities()["modalities"]:
        row = {k: v for k, v in m.items() if k != "keys"}
        keys = set(m["keys"])
        if m["entity"] == "drug":
            for k in ("drug1", "drug2"):
                if want[k]:
                    row[k + "_available"] = str(int(float(want[k]))) in keys
        elif m["entity"] == "cell_line" and want["cell"]:
            row["cell_available"] = str(int(float(want["cell"]))) in keys
        out.append(row)
    return {"data_dir": modalities()["data_dir"], "modalities": out, "note": modalities().get("note", "")}
