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
  // flexible parsing
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
  // map a few Sonar measures to our norms (0..100)
  const norms: Partial<Record<string, number>> = {};
  // coverage from Sonar: 'coverage' value is percentage
  norms.correctness = measures.coverage ? Math.round(Number(measures.coverage)) : 0;

  // vulnerabilities: Sonar 'vulnerabilities' is a count -> penalize
  const vulns = Number(measures.vulnerabilities ?? 0);
  norms.security = Math.max(0, 100 - vulns * 25); // tune multiplier

  // code smells -> penalize
  const smells = Number(measures.code_smells ?? 0);
  norms.maintainability = Math.max(0, 100 - smells * 0.2); // small penalty

  // duplication in percent => map to duplication norm
  const dup = Number(measures.duplicated_lines_density ?? 0);
  norms.duplication = Math.max(0, Math.round(100 - dup));

  // complexity (sonar's complexity measure is total complexity) -> convert heuristically
  const complexity = Number(measures.complexity ?? 0);
  norms.maintainability = Math.round(Math.max(0, Math.min(100, norms.maintainability ?? 100 - complexity * 0.05)));

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
    correctness: normCoverage(coverage),
    security: normSemgrep(semgrepJson), // initial security from semgrep
    maintainability: normComplexity(escomplexJson),
    readability: normESLint(eslintJson, totalLines),
    robustness: 90, // placeholder, recommend adding semgrep rules for missing try/catch / null checks
    duplication: 95,
    performance: 85,
    consistency: 90,
  };

  // incorporate Sonar measures (blending)
  if (sonarMetricsRaw) {
    const sonarMap = readSonarMetrics(sonarMetricsRaw);
    const sonarNorms = normFromSonarMeasure(sonarMap);
    // merge/blend sonarNorms into norms with conservative approach (take min where sonar indicates worse)
    for (const k of Object.keys(sonarNorms)) {
      const val = sonarNorms[k];
      if (typeof val === "number") norms[k] = Math.round(((norms[k] ?? 0) + val) / 2); // simple average blend
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
  const out = { score, norms, weights, timestamp: new Date().toISOString() };

  fs.writeFileSync("composite_score.txt", String(score), "utf8");
  fs.writeFileSync("score_report.json", JSON.stringify(out, null, 2), "utf8");
  console.log("Composite Score:", score);
  console.log("Norms:", norms);
}

main();
