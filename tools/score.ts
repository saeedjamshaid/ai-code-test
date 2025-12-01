// tools/score.ts
import fs from "fs";

type Norms = Record<string, number>;
type Weights = Record<string, number>;
type AgentScoreCard = {
  fixAttempts?: number;
  issuesFound?: number;
  issuesFixed?: number;
  [key: string]: any;
};

function safeRead(p: string) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.warn("failed to read", p, e);
    return null;
  }
}

function applyAgentScoreCard(norms: Norms) {
  const scoreCard = safeRead("tools/AgentScoreCard.json") as AgentScoreCard | null;
  if (!scoreCard) return;

  const fieldMap: Record<string, keyof AgentScoreCard> = {
    issuesFound: "issuesFound",
    issuesFixed: "issuesFixed",
    fixAttempts: "fixAttempts"
  };

  for (const [normKey, cardKey] of Object.entries(fieldMap)) {
    const raw = scoreCard[cardKey];
    const val = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isNaN(val)) {
      norms[normKey] = val;
    }
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

  console.log("[Sonar] code_smells:", measures.code_smells);
  console.log("[Sonar] sqale_index:", measures.sqale_index);
  console.log("[Sonar] complexity:", measures.complexity);
  console.log("[Sonar] duplicated_lines_density:", measures.duplicated_lines_density);
  console.log("[Sonar] reliability_rating:", measures.reliability_rating);
  console.log("[Sonar] security_rating:", measures.security_rating);

  const smells = Number(measures.code_smells ?? 0);
  norms.maintainability = Math.max(0, 100 - (smells * 0.2) - (measures.sqale_index * 0.2));
  // code_smells: #
  // sqale_index: mins

  const complexity = Number(measures.complexity ?? 0);
  norms.performance = Math.max(Math.max(0, 100 - complexity));
  // complexity: mins

  const dup = Number(measures.duplicated_lines_density ?? 0);
  norms.duplication = Math.max(0, Math.round(100 - dup));
  // duplicated_lines_density: %
  
  norms.reliability = Math.max(0, 100 - (measures.reliability_rating * 0.2));
  // reliability_rating: 1 (best) - 5 (worst)

  norms.security = Math.max(0, 100 - (measures.security_rating * 0.2));
  // security_rating: 1 (best) - 5 (worst)

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

function main(): Norms {
  const coverage = safeRead("coverage/coverage-summary.json");
  const eslintJson = safeRead("eslint.json");
  const semgrepJson = safeRead("semgrep.json");
  const escomplexJson = safeRead("escomplex.json");
  const filesInfo = safeRead("files_info.json") || { total_lines: 0 };
  const sonarMetricsRaw = safeRead("sonar_metrics.json");

  const totalLines = filesInfo?.total_lines ?? 0;

  // norms from individual tools
  // (initialize defaults; individual normalizers can override)
  const norms: Norms = {
    // Correctness
    unitTestPassRate: -1,
    compilation: -1,
    issuesFound: -1,
    issuesFixed: -1,
    // Efficiency
    fixAttempts: -1,
    // Quality
    security: -1,
    reliability: -1,
    maintainability: -1,
    duplication: -1,
    performance: -1
  };

  applyAgentScoreCard(norms);

  // incorporate Sonar measures
  if (sonarMetricsRaw) {
    const sonarMap = readSonarMetrics(sonarMetricsRaw);
    const sonarNorms = normFromSonarMeasure(sonarMap);
    for (const k of Object.keys(sonarNorms)) {
      const val = sonarNorms[k];
      if (typeof val === "number") {
        // Prefer Sonar-derived norm; overwrite any existing value.
        norms[k] = val;
      }
    }
  }

  // Primary output is just norms; logs are kept for visibility.
  fs.writeFileSync("norms.json", JSON.stringify(norms, null, 2), "utf8");
  console.log("Norms:", norms);

  return norms;
}

const norms = main();
export default norms;
