import { AnalysisDefinition } from './types'

export const ANALYTICS_REGISTRY: AnalysisDefinition[] = [
  // ── SPC ──────────────────────────────────────────────────
  {
    name: 'control_chart',
    category: 'spc',
    title: 'Control Chart (XmR / X-bar R)',
    description: 'Calculates mean, UCL, LCL and identifies out-of-control points using Western Electric rules.',
    when_to_use: 'Is this variation normal? Is the process in control? Should we act on this reading? Is this trend real or noise?',
    required_inputs: ['values: number[]'],
    optional_inputs: ['labels: string[]', 'type: "XmR" | "XbarR" (default: XmR)', 'subgroup_size: number'],
    output_summary: 'mean, ucl, lcl, sigma, out_of_control_points (with rule violated), trend_detected, western_electric_violations',
    example_question: 'Is the vibration on Compressor 4 showing a real upward trend or normal variation?',
  },
  {
    name: 'process_capability',
    category: 'spc',
    title: 'Process Capability (Cp, Cpk, Pp, Ppk)',
    description: 'Calculates capability indices given a dataset and specification limits.',
    when_to_use: 'Are we capable of holding this tolerance? What is our Cpk? Can this process meet the spec?',
    required_inputs: ['values: number[]', 'lsl: number (lower spec limit)', 'usl: number (upper spec limit)'],
    optional_inputs: ['target: number'],
    output_summary: 'cp, cpk, pp, ppk, sigma, mean, std_dev, percent_out_of_spec, capability_rating',
    example_question: 'Are we capable of holding ±0.05mm on this dimension?',
  },
  // ── Time Series ──────────────────────────────────────────
  {
    name: 'trend',
    category: 'time_series',
    title: 'Linear Trend Analysis',
    description: 'Fits a linear regression to time-series data, tests statistical significance, estimates time to threshold.',
    when_to_use: 'Is there an upward/downward trend? How fast is this degrading? When will it hit the limit?',
    required_inputs: ['values: number[]'],
    optional_inputs: ['labels: string[]', 'threshold: number', 'timestamps: number[]'],
    output_summary: 'slope, intercept, r_squared, p_value, slope_significant, trend_direction, days_to_threshold',
    example_question: 'Is bearing temperature trending upward and when will it exceed the alarm threshold?',
  },
  {
    name: 'anomaly_detection',
    category: 'time_series',
    title: 'Anomaly Detection',
    description: 'Identifies statistical outliers using Z-score and IQR methods.',
    when_to_use: 'Are there any unusual readings? What are the outliers? Which data points are abnormal?',
    required_inputs: ['values: number[]'],
    optional_inputs: ['labels: string[]', 'method: "zscore" | "iqr" | "both" (default: both)', 'threshold: number'],
    output_summary: 'anomalies (index, value, score, method), anomaly_count, anomaly_rate, bounds',
    example_question: 'Are there any unusual spikes in the pressure readings from last week?',
  },
  {
    name: 'changepoint_detection',
    category: 'time_series',
    title: 'Changepoint Detection',
    description: 'Detects when a process fundamentally shifted using cumulative sum (CUSUM) method.',
    when_to_use: 'When did this change? Did something happen to the process? When did performance degrade?',
    required_inputs: ['values: number[]'],
    optional_inputs: ['labels: string[]', 'sensitivity: number (0-1, default 0.5)'],
    output_summary: 'changepoints (index, label, magnitude, direction), segment_means, most_significant_change',
    example_question: 'When did the OEE on Line B start declining?',
  },
  // ── Reliability ──────────────────────────────────────────
  {
    name: 'weibull',
    category: 'reliability',
    title: 'Weibull Failure Analysis',
    description: 'Fits a Weibull distribution to time-to-failure data, calculates MTBF and failure probability.',
    when_to_use: 'What is the MTBF? What is the probability of failure by time T? Is this infant mortality or wear-out?',
    required_inputs: ['failure_times: number[]'],
    optional_inputs: ['suspended_times: number[]', 'time_unit: string'],
    output_summary: 'beta (shape), eta (scale), mtbf, b10_life, b50_life, failure_probability_curve, failure_mode (infant/random/wear-out)',
    example_question: 'What is the expected MTBF on these motors given the failure history?',
  },
  {
    name: 'mtbf',
    category: 'reliability',
    title: 'MTBF / MTTR / Availability',
    description: 'Calculates mean time between failures, mean time to repair, and availability from event timestamps.',
    when_to_use: 'What is the MTBF? What is the availability? How long does repair typically take?',
    required_inputs: ['failure_timestamps: number[]', 'repair_durations: number[]'],
    optional_inputs: ['observation_period: number'],
    output_summary: 'mtbf, mttr, availability, failure_rate, repair_rate, total_failures, total_downtime',
    example_question: 'What is the availability and MTBF for the hydraulic press this quarter?',
  },
  // ── Quality ──────────────────────────────────────────────
  {
    name: 'pareto',
    category: 'quality',
    title: 'Pareto Analysis',
    description: 'Ranks categories by frequency/impact, calculates cumulative percentages, identifies the vital few.',
    when_to_use: 'What are the top causes? Which defect types account for 80% of failures? What should we fix first?',
    required_inputs: ['categories: string[]', 'values: number[]'],
    optional_inputs: ['threshold_pct: number (default: 80)'],
    output_summary: 'ranked items with value, percentage, cumulative_percentage, vital_few (items reaching threshold), trivial_many',
    example_question: 'Which fault codes account for 80% of our downtime on Line B?',
  },
  // ── Correlation ──────────────────────────────────────────
  {
    name: 'correlation',
    category: 'correlation',
    title: 'Correlation Analysis',
    description: 'Calculates Pearson and Spearman correlation between two variables, tests significance.',
    when_to_use: 'Is there a relationship between X and Y? Does temperature affect defect rate? What correlates with OEE?',
    required_inputs: ['x: number[]', 'y: number[]'],
    optional_inputs: ['x_label: string', 'y_label: string'],
    output_summary: 'pearson_r, pearson_p, spearman_r, spearman_p, significant, relationship_strength, relationship_direction',
    example_question: 'Is there a relationship between ambient temperature and defect rate on Line A?',
  },
  {
    name: 'regression',
    category: 'correlation',
    title: 'Linear / Multivariate Regression',
    description: 'Fits linear regression model, returns coefficients, R², p-values per predictor.',
    when_to_use: 'What factors predict X? What drives OEE? Which variables most influence failure rate?',
    required_inputs: ['y: number[]', 'X: number[][] (predictor matrix)', 'feature_names: string[]'],
    optional_inputs: [],
    output_summary: 'coefficients (name, value, p_value, significant), r_squared, adj_r_squared, rmse, significant_predictors',
    example_question: 'What machine parameters most predict bearing failure?',
  },
  // ── OEE ──────────────────────────────────────────────────
  {
    name: 'oee_decomposition',
    category: 'oee',
    title: 'OEE Decomposition',
    description: 'Decomposes OEE into Availability, Performance, Quality components with benchmarking.',
    when_to_use: 'What is driving our OEE loss? Is it availability, performance or quality? How do we compare to world class?',
    required_inputs: ['planned_time: number', 'run_time: number', 'ideal_cycle_time: number', 'total_count: number', 'good_count: number'],
    optional_inputs: ['benchmark_oee: number (default: 0.85)'],
    output_summary: 'oee, availability, performance, quality, losses (availability_loss, performance_loss, quality_loss), vs_benchmark, biggest_loss_driver',
    example_question: 'What is driving the OEE loss on Line B — is it availability, speed or quality?',
  },
  // ── Hypothesis ───────────────────────────────────────────
  {
    name: 'hypothesis_test',
    category: 'hypothesis',
    title: 'Hypothesis Test (t-test / ANOVA)',
    description: 'Tests whether two or more groups are statistically different.',
    when_to_use: 'Is shift A actually worse than shift B? Are these machines performing differently? Is this difference real?',
    required_inputs: ['groups: number[][] (array of value arrays)', 'group_labels: string[]'],
    optional_inputs: ['alpha: number (default: 0.05)', 'test: "ttest" | "anova" | "auto" (default: auto)'],
    output_summary: 'test_used, statistic, p_value, significant, group_stats (mean, std, n per group), conclusion',
    example_question: 'Is the defect rate on the night shift statistically higher than the day shift?',
  },
]

export function formatAnalyticsForPrompt(disabled: string[] = [], available?: string[] | null): string {
  // `available` is the set of analyses the stats sidecar actually implements
  // (from /capabilities). When provided, we only advertise analyses that are
  // both not-admin-disabled AND genuinely runnable — so a registry entry with no
  // sidecar handler is simply never offered, instead of failing at run time.
  // When null/undefined (capabilities unknown, e.g. sidecar unreachable), we fall
  // back to advertising the full registry rather than nothing.
  const active = ANALYTICS_REGISTRY.filter(a =>
    !disabled.includes(a.name) && (!available || available.includes(a.name))
  )
  const byCategory: Record<string, AnalysisDefinition[]> = {}
  for (const a of active) {
    if (!byCategory[a.category]) byCategory[a.category] = []
    byCategory[a.category].push(a)
  }
  const lines: string[] = ['## Statistical Analysis (run_statistical_analysis tool)']
  lines.push(`Use this tool AFTER querying data when the question requires statistical computation. ${disabled.length ? `(${disabled.length} analysis type(s) disabled by admin)` : ''}`)
  lines.push('Pass the data array from the previous query_database result.')
  lines.push('')
  for (const [cat, analyses] of Object.entries(byCategory)) {
    lines.push(`### ${cat.toUpperCase().replace('_', ' ')}`)
    for (const a of analyses) {
      lines.push(`- **${a.name}**: ${a.description}`)
      lines.push(`  Use when: "${a.when_to_use}"`)
      // Surface the expected input shape so the model passes data correctly —
      // notably hypothesis_test needs grouped arrays, unlike the flat array the
      // other analyses take.
      if (a.required_inputs?.length) lines.push(`  Inputs: ${a.required_inputs.join('; ')}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

// ── Sidecar capability discovery ─────────────────────────────
// Fetch (and cache) the list of analyses the stats sidecar actually implements,
// so formatAnalyticsForPrompt only advertises runnable ones. Cached for a short
// TTL to avoid hitting the sidecar on every chat request; on any failure we
// return null, which makes the caller fall back to the full registry (fail-open
// — never silently drop all analyses because the capability probe hiccuped).
let _capCache: { at: number; analyses: string[] | null } = { at: 0, analyses: null }
const CAP_TTL_MS = 60_000

export async function getSidecarCapabilities(): Promise<string[] | null> {
  const now = Date.now()
  if (_capCache.analyses && now - _capCache.at < CAP_TTL_MS) return _capCache.analyses
  const base = process.env.STATS_SIDECAR_URL || 'http://localhost:8001'
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2000)
    const res = await fetch(`${base}/capabilities`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const data = await res.json() as { analyses?: string[] }
    const analyses = Array.isArray(data.analyses) ? data.analyses : null
    _capCache = { at: now, analyses }
    return analyses
  } catch {
    return null  // unreachable / older sidecar without /capabilities -> fall back to full registry
  }
}
