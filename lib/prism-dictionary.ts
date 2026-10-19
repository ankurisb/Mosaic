// lib/prism-dictionary.ts
// Pure helpers for the PRISM semantic-dictionary auto-describe path. Kept free of
// I/O so the sampling/ranking/coverage logic is unit-testable: generatePrismDraft
// (app/api/semantic/route.ts) does the PRISM fetches and feeds the results here.
//
// Why this exists: PRISM/ThingsBoard fleets routinely type every device "default"
// and SPREAD the telemetry vocabulary across devices (one inverter reports kWh/kW,
// a meter reports v1n, a weather station reports slr_rdtn). You cannot learn the
// dictionary from one device — you must union keys across many — and you must be
// able to tell the user *why* a run came back thin (no data yet vs auth failure vs
// genuinely sparse) rather than silently drafting junk.

export const PRISM_SAMPLE_DEVICES = 50   // devices to probe for the key vocabulary
export const PRISM_VALUE_DEVICES = 10    // richest devices to pull latest values from
export const PRISM_MAX_KEYS = 120        // cap on distinct keys sent to the model

/** Per-device result of listing telemetry keys. `error` set => that fetch failed. */
export interface DeviceKeyResult {
  id: string
  name: string
  keys?: string[]
  error?: string
}

export interface PrismSamplePlan {
  keys: string[]                       // distinct keys, ranked by device-frequency desc, capped
  keyFreq: Record<string, number>      // key -> how many sampled devices report it
  valueDeviceIds: string[]             // richest devices, for latest-value sampling
  devicesAttempted: number
  devicesWithKeys: number
  devicesErrored: number
}

/**
 * Union telemetry keys across the per-device results, rank by how many devices
 * report each key (most-common first — those are the core channels), cap the list,
 * and pick the richest devices to sample latest values from. Deterministic:
 * ties broken alphabetically so tests and reruns are stable.
 */
export function planPrismSample(
  results: DeviceKeyResult[],
  maxKeys: number = PRISM_MAX_KEYS,
  valueDevices: number = PRISM_VALUE_DEVICES,
): PrismSamplePlan {
  const keyFreq = new Map<string, number>()
  const withKeys: DeviceKeyResult[] = []
  let errored = 0
  for (const r of results) {
    if (r.error) { errored++; continue }
    const keys = Array.isArray(r.keys) ? r.keys.filter(k => typeof k === 'string' && k.length > 0) : []
    if (!keys.length) continue
    withKeys.push({ ...r, keys })
    for (const k of new Set(keys)) keyFreq.set(k, (keyFreq.get(k) || 0) + 1)
  }
  const ranked = [...keyFreq.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([k]) => k)
  const keys = ranked.slice(0, maxKeys)
  const valueDeviceIds = [...withKeys]
    .sort((a, b) => (b.keys!.length - a.keys!.length) || a.id.localeCompare(b.id))
    .slice(0, valueDevices)
    .map(d => d.id)
  return {
    keys,
    keyFreq: Object.fromEntries(keyFreq),
    valueDeviceIds,
    devicesAttempted: results.length,
    devicesWithKeys: withKeys.length,
    devicesErrored: errored,
  }
}

export type CoverageStatus = 'ok' | 'sparse' | 'empty_fleet' | 'no_keys_errors' | 'no_keys_empty'

export interface CoverageAssessment {
  status: CoverageStatus
  proceed: boolean          // whether to proceed to the model draft
  message?: string          // actionable remedy (when !proceed) or a warning (when sparse)
}

/**
 * Decide whether the gathered vocabulary is good enough to draft from, and if not,
 * return an actionable message naming the likely cause and the fix. The key
 * distinction: an empty result because devices error out (auth/connectivity)
 * reads very differently from one because devices simply have no timeseries yet.
 */
export function assessPrismCoverage(
  fleetSize: number,
  plan: PrismSamplePlan,
  sampleErrorExample?: string,
): CoverageAssessment {
  if (fleetSize <= 0) {
    return { status: 'empty_fleet', proceed: false,
      message: 'No devices found on this PRISM instance. Add or activate devices in PRISM, then run Describe again.' }
  }
  if (plan.keys.length === 0) {
    // Mostly errors while listing keys => almost always auth/connectivity, not "no data".
    if (plan.devicesWithKeys === 0 && plan.devicesErrored > 0 && plan.devicesErrored >= Math.ceil(plan.devicesAttempted / 2)) {
      const eg = sampleErrorExample ? ` (e.g. "${sampleErrorExample}")` : ''
      return { status: 'no_keys_errors', proceed: false,
        message: `Sampled ${plan.devicesAttempted} device(s) but ${plan.devicesErrored} returned an error while listing telemetry keys${eg}. This is usually an authentication or connectivity problem — open Settings → PRISM and use "Test connection", then retry.` }
    }
    return { status: 'no_keys_empty', proceed: false,
      message: `Sampled ${plan.devicesAttempted} device(s) but none report timeseries telemetry keys yet. Likely the devices haven't sent data, or their values are stored as attributes rather than timeseries. Confirm a device shows "Latest telemetry" in PRISM, then retry.` }
  }
  // Many devices, almost no distinct keys => flag low confidence but still draft.
  if (plan.devicesWithKeys >= 10 && plan.keys.length <= 2) {
    return { status: 'sparse', proceed: true,
      message: `Only ${plan.keys.length} distinct telemetry key(s) found across ${plan.devicesWithKeys} device(s) — the fleet may still be warming up. Descriptions were drafted anyway; re-run later for fuller coverage.` }
  }
  return { status: 'ok', proceed: true }
}

export interface PrismDiagnostics {
  fleet_size: number
  devices_sampled: number
  devices_with_keys: number
  devices_errored: number
  distinct_keys: number
  keys_with_values: number
  keys_described: number
  coverage_status: CoverageStatus
}

/** One-line human summary for the dictionary editor, so the user can judge confidence. */
export function summarizePrismDraft(d: PrismDiagnostics): string {
  const inferred = Math.max(0, d.keys_described - d.keys_with_values)
  const valPart = d.keys_described
    ? ` ${d.keys_with_values} had live sample values${inferred ? `, ${inferred} inferred from the key name` : ''}.`
    : ''
  return `Described ${d.keys_described} of ${d.distinct_keys} telemetry key(s) from ${d.devices_with_keys} of ${d.devices_sampled} sampled device(s) (${d.fleet_size} in fleet).${valPart}`
}
