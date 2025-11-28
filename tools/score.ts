// tools/score.ts
import fs from "fs";

type Norms = Record<string, number>;
type Weights = Record<string, number>;

function safeRead(p: string) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.warn("failed to read", p, e);
    return null;
  }
}

/* Normalizers */

// coverage from coverage-summary.json (jest json-summary)
function normCoverage(cov: any): number {
  try {
    const pct = cov?.total?.lines?.pct ?? cov?.total?.lines?.percentage ?? 0;
    return Math.round(Math.max(0, Math.min(100, pct)));
  } catch {
    return 0;
  }
}

// eslint.json => errors per KLOC -> norm
function normESLint(eslintJson: any, totalLines: number): number {
  if (!eslintJson) return 100;
  const reports = Array.isArray(eslintJson) ? eslintJson : [];
  const totalMessages = reports.reduce((acc: number, r: any) => acc + (r.messages?.length ?? 0), 0);
  const kloc = Math.max(0.001, totalLines / 1000);
  const errorsPerKloc = totalMessages / kloc;
  return Math.round(Math.max(0, Math.min(100, 100 - errorsPerKloc * 8)));
}

// semgrep.json => severity-based penalty
function normSemgrep(semgrepJson: any): number {
  if (!semgrepJson) return 100;
  const results = semgrepJson.results ?? semgrepJson;
  let score = 100;
  for (const r of results) {
    const sev = (r.extra?.severity || r.severity || "INFO").toString().toUpperCase();
    if (["CRITICAL", "HIGH"].includes(sev)) score -= 30;
    else if (["MEDIUM"].includes(sev)) score -= 10;
    else score -= 2;
  }
  return Math.max(0, score);
}

// escomplex.json -> average cyclomatic -> norm
function normComplexity(escomplexJson: any): number {
  if (!escomplexJson) return 100;
  let vals: number[] = [];
  const collect = (obj: any) => {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (k.toLowerCase().includes("cyclomatic") && typeof v === "number") vals.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (typeof v === "object") collect(v);
    }
  };
  collect(escomplexJson);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 1;
  return Math.round(Math.max(0, Math.min(100, 100 - 5 * (avg - 1))));
}

// Sonar metrics: sonar_metrics.json contains measures array
function readSonarMetrics(sonarJson: any) {
  const out: Record<string, number | string> = {};
  try {
    const measures = sonarJson?.component?.measures ?? [];
    for (const m of measures) {
      out[m.metric] = m.value;
    }
  } catch (e) {
    console.warn("sonar parsing failed", e);
  }
  return out;
}

function normFromSonarMeasure(measures: Record<string, any>) {
  const norms: Partial<Record<string, number>> = {};

  // const vulns = Number(measures.vulnerabilities ?? 0);
  // norms.security = Math.max(0, 100 - vulns * 25);

  console.log("[Sonar] code_smells:", measures.code_smells);
  const smells = Number(measures.code_smells ?? 0);
  norms.maintainability = Math.max(0, 100 - smells * 0.2);
  
  console.log("[Sonar] sqale_index (technical_debt):", measures.sqale_index);

  console.log("[Sonar] complexity:", measures.complexity);
  const complexity = Number(measures.complexity ?? 0);
  norms.performance = Math.max(Math.max(0, 100 - complexity));

  console.log("[Sonar] duplicated_lines_density:", measures.duplicated_lines_density);
  const dup = Number(measures.duplicated_lines_density ?? 0);
  norms.duplication = Math.max(0, Math.round(100 - dup));
  
  console.log("[Sonar] bugs:", measures.bugs);
  console.log("[Sonar] reliability_remediation_effort:", measures.reliability_remediation_effort);

  // reliability: -1,

  return norms as Record<string, number>;
}

/* Composite computation */
function computeComposite(norms: Norms, weights: Weights): number {
  let s = 0;
  for (const k of Object.keys(weights)) {
    const w = weights[k] ?? 0;
    const m = norms[k] ?? 0;
    s += m * (w / 100);
  }
  return Math.round(s * 100) / 100;
}

function main() {
  const coverage = safeRead("coverage/coverage-summary.json");
  const eslintJson = safeRead("eslint.json");
  const semgrepJson = safeRead("semgrep.json");
  const escomplexJson = safeRead("escomplex.json");
  const filesInfo = safeRead("files_info.json") || { total_lines: 0 };
  const sonarMetricsRaw = safeRead("sonar_metrics.json");

  const totalLines = filesInfo?.total_lines ?? 0;

  // norms from individual tools
  const norms: Norms = {
    // Correctness
    unitTestPassRate: -1,
    compilation:0,
    autofixSuccessRate:0,
    // Efficiency
    tokenusage:0,
    timeToFirstWorkingSolution:0,
    fixAttempts:0,
    // Quality
    security: normSemgrep(semgrepJson),
    reliability: -1,
    maintainability: -1,
    duplication:-1,
    performance: -1
  };

  // incorporate Sonar measures
  if (sonarMetricsRaw) {
    const sonarMap = readSonarMetrics(sonarMetricsRaw);
    const sonarNorms = normFromSonarMeasure(sonarMap);
    for (const k of Object.keys(sonarNorms)) {
      const val = sonarNorms[k];
      if (typeof val === "number") norms[k] = Math.round(((norms[k] ?? 0) + val) / 2);
    }
  }

  const weights: Weights = {
    correctness: 25,
    security: 20,
    maintainability: 15,
    readability: 10,
    robustness: 10,
    duplication: 6,
    performance: 6,
    consistency: 8
  };

  const score = computeComposite(norms, weights);

  // Write outputs
  fs.writeFileSync("composite_score.txt", String(score), "utf8");

  // Detailed per-category breakdown for workflow artifact
  const breakdown: Record<string, number> = {};
  for (const k of Object.keys(weights)) {
    breakdown[k] = norms[k] ?? 0;
  }
  fs.writeFileSync("score_breakdown.json", JSON.stringify(breakdown, null, 2), "utf8");

  // Full report for debugging/history
  const fullReport = { score, norms, weights, timestamp: new Date().toISOString() };
  fs.writeFileSync("score_report.json", JSON.stringify(fullReport, null, 2), "utf8");

  console.log("Composite Score:", score);
  console.log("Per-category breakdown:", breakdown);
}

main();
