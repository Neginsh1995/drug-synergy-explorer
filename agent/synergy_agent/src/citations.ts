import type { Paper } from "./pubmed.ts";
import { verifyDoiAgainstRecords } from "./pubmed.ts";
import type { Assessment, Citation, Issue } from "./types.ts";

export function pmidDigits(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function enforceCitationAllowlist(citations: Citation[], allow: Set<string>): {
  kept: Citation[];
  issues: Issue[];
} {
  const issues: Issue[] = [];
  const kept: Citation[] = [];
  for (const c of citations) {
    const pmid = pmidDigits(c.pmid);
    if (!pmid) {
      issues.push({ severity: "high", text: "Citation missing PMID; removed. LLM may not invent identifiers." });
      continue;
    }
    if (!allow.has(pmid)) {
      issues.push({
        severity: "high",
        text: `PMID ${pmid} was not in the code-retrieved corpus; removed. Unverified PMIDs are rejected.`,
      });
      continue;
    }
    kept.push({ ...c, pmid });
  }
  return { kept, issues };
}

export function attachDoisFromRecords(citations: Citation[], records: Paper[]): Citation[] {
  const byPmid = new Map(records.map((p) => [p.pmid, p]));
  return citations.map((c) => {
    const paper = byPmid.get(c.pmid);
    if (!paper) return { ...c, doi: c.doi, doi_verified: false };
    const claimed = c.doi?.trim() || null;
    if (!claimed) {
      return { ...c, doi: paper.doi, doi_verified: Boolean(paper.doi) };
    }
    const check = verifyDoiAgainstRecords(claimed, [paper]);
    if (!check.verified) {
      return { ...c, doi: paper.doi, doi_verified: Boolean(paper.doi) };
    }
    return { ...c, doi: paper.doi ?? claimed, doi_verified: true };
  });
}

export function codeSupportChecks(assessment: Assessment, records: Paper[], allow: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const { kept, issues: allowIssues } = enforceCitationAllowlist(assessment.citations, allow);
  issues.push(...allowIssues);
  assessment.citations = attachDoisFromRecords(kept, records);
  const found = new Map(records.map((p) => [p.pmid, p]));

  for (const c of assessment.citations) {
    const paper = found.get(c.pmid);
    if (!paper) {
      issues.push({ severity: "high", text: `PMID ${c.pmid} did not resolve on PubMed efetch.` });
      continue;
    }
    if (!paper.abstract_available) {
      issues.push({
        severity: "medium",
        text: `PMID ${c.pmid} has no abstract; methods/results details are unknown from this retrieval (not full text).`,
      });
    }
    const blob = `${paper.title} ${paper.abstract}`.toLowerCase();
    const d1 = assessment.Drug1.toLowerCase();
    const d2 = assessment.Drug2.toLowerCase();
    const bothNamed = blob.includes(d1) && blob.includes(d2);
    const cell = assessment.cell_line_original.toLowerCase();
    const cellMentioned = cell.length > 0 && blob.includes(cell);

    if (assessment.direct_experimental_synergy === "yes" && !bothNamed) {
      issues.push({
        severity: "high",
        text: `direct_experimental_synergy=yes is not supported by PMID ${c.pmid}: abstract/title does not name both drugs. Combination/pathway overlap is not synergy.`,
      });
    }
    if (assessment.cell_line_evidence_level === "exact_cell_line" && !cellMentioned) {
      issues.push({
        severity: "high",
        text: `cell_line_evidence_level=exact_cell_line is not supported by PMID ${c.pmid}: requested cell_line "${assessment.cell_line_original}" is not named in title/abstract (unknown, not inferred).`,
      });
    }
    if (assessment.evidence_class === "direct_experimental_synergy_exact_cell" && (!bothNamed || !cellMentioned)) {
      issues.push({
        severity: "high",
        text: `evidence_class overstated for PMID ${c.pmid}: exact-cell synergy requires the pair and the requested cell line in the retrieved abstract.`,
      });
    }
  }

  if (
    assessment.evidence_class !== "insufficient_or_conflicting" &&
    assessment.evidence_class !== "computational_prediction_only" &&
    assessment.citations.length === 0
  ) {
    issues.push({
      severity: "high",
      text: "No verified citations remain; evidence_class cannot stay above computational/insufficient.",
    });
  }
  return issues;
}

export function corpusBlock(papers: Paper[]): string {
  if (!papers.length) return "(no PubMed records retrieved by code)";
  return papers
    .map((p) => {
      const abs = p.abstract_available ? p.abstract.slice(0, 900) : "(no abstract; full text not retrieved)";
      return `PMID ${p.pmid}${p.doi ? ` DOI ${p.doi}` : " DOI unverified/absent"} (${p.year}) ${p.title}\nABSTRACT: ${abs}`;
    })
    .join("\n\n");
}
