from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Optional
import numpy as np
from scipy import stats
import warnings
warnings.filterwarnings("ignore")

app = FastAPI(title="Mosaic Stats Sidecar", version="1.0.0")

class AnalysisRequest(BaseModel):
    analysis_type: str
    data: Any
    params: Optional[dict] = {}

@app.get("/health")
def health():
    return {"ok": True, "service": "mosaic-stats"}

@app.get("/capabilities")
def capabilities():
    # Report the analyses this sidecar actually implements. Mosaic intersects
    # this with its analysis registry so the AI is only ever told about analyses
    # that can genuinely be computed — a registry entry with no handler here is
    # simply not offered, rather than failing at run time.
    return {"analyses": sorted(HANDLERS.keys())}

@app.post("/analyse")
def analyse(req: AnalysisRequest):
    try:
        fn = HANDLERS.get(req.analysis_type)
        if not fn:
            raise HTTPException(400, f"Unknown analysis type: {req.analysis_type}. Available: {list(HANDLERS.keys())}")
        result = fn(req.data, req.params or {})
        return {"analysis_type": req.analysis_type, "ok": True, "result": result}
    except HTTPException:
        raise
    except Exception as e:
        return {"analysis_type": req.analysis_type, "ok": False, "error": str(e), "result": {}}

# ── Helpers ──────────────────────────────────────────────────

def to_float_array(data):
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
        # Extract first numeric field from dicts
        for key in data[0]:
            try:
                arr = [float(d[key]) for d in data if d.get(key) is not None]
                if arr:
                    return np.array(arr)
            except (ValueError, TypeError):
                continue
        raise ValueError("No numeric field found in data objects")
    return np.array([float(x) for x in data])

# ── Control Chart (XmR) ──────────────────────────────────────

def control_chart(data, params):
    values = to_float_array(data)
    labels = params.get("labels", [str(i) for i in range(len(values))])
    n = len(values)
    if n < 4:
        raise ValueError("Need at least 4 data points for a control chart")

    mean = float(np.mean(values))
    # Moving ranges for XmR
    mr = np.abs(np.diff(values))
    mr_bar = float(np.mean(mr))
    d2 = 1.128  # constant for n=2 subgroups
    sigma = mr_bar / d2
    ucl = mean + 3 * sigma
    lcl = mean - 3 * sigma

    # Western Electric rules
    out_of_control = []
    for i, v in enumerate(values):
        violations = []
        # Rule 1: Beyond 3 sigma
        if v > ucl or v < lcl:
            violations.append("Rule 1: Beyond 3-sigma")
        # Rule 2: 2 of 3 beyond 2 sigma
        if i >= 2:
            zone_a = mean + 2 * sigma
            zone_a_l = mean - 2 * sigma
            window = values[max(0,i-2):i+1]
            if sum(1 for x in window if x > zone_a) >= 2 or sum(1 for x in window if x < zone_a_l) >= 2:
                violations.append("Rule 2: 2 of 3 beyond 2-sigma")
        # Rule 3: 4 of 5 beyond 1 sigma
        if i >= 4:
            zone_b = mean + sigma
            zone_b_l = mean - sigma
            window = values[max(0,i-4):i+1]
            if sum(1 for x in window if x > zone_b) >= 4 or sum(1 for x in window if x < zone_b_l) >= 4:
                violations.append("Rule 3: 4 of 5 beyond 1-sigma")
        # Rule 4: 8 consecutive same side
        if i >= 7:
            window = values[i-7:i+1]
            if all(x > mean for x in window) or all(x < mean for x in window):
                violations.append("Rule 4: 8 consecutive same side of mean")
        if violations:
            out_of_control.append({"index": i, "label": labels[i] if i < len(labels) else str(i), "value": float(v), "violations": violations})

    # Trend detection via linear regression
    x = np.arange(n)
    slope, _, r, p, _ = stats.linregress(x, values)
    trend_detected = bool(p < 0.05 and abs(r) > 0.5)

    return {
        "mean": round(mean, 4),
        "ucl": round(ucl, 4),
        "lcl": round(lcl, 4),
        "sigma": round(sigma, 4),
        "mr_bar": round(mr_bar, 4),
        "n": n,
        "out_of_control_points": out_of_control,
        "out_of_control_count": len(out_of_control),
        "trend_detected": trend_detected,
        "trend_slope": round(float(slope), 6),
        "trend_p_value": round(float(p), 4),
        "western_electric_violations": len(out_of_control),
        "process_in_control": len(out_of_control) == 0,
    }

# ── Process Capability ───────────────────────────────────────

def process_capability(data, params):
    values = to_float_array(data)
    lsl = float(params.get("lsl", params.get("LSL")))
    usl = float(params.get("usl", params.get("USL")))
    target = float(params.get("target", (lsl + usl) / 2))
    mean = float(np.mean(values))
    std = float(np.std(values, ddof=1))
    if std == 0:
        raise ValueError("Standard deviation is zero — all values are identical")

    cp  = (usl - lsl) / (6 * std)
    cpu = (usl - mean) / (3 * std)
    cpl = (mean - lsl) / (3 * std)
    cpk = min(cpu, cpl)
    pp  = (usl - lsl) / (6 * float(np.std(values)))
    ppu = (usl - mean) / (3 * float(np.std(values)))
    ppl = (mean - lsl) / (3 * float(np.std(values)))
    ppk = min(ppu, ppl)

    out_of_spec = sum(1 for v in values if v < lsl or v > usl)
    pct_out = out_of_spec / len(values) * 100

    if cpk >= 1.67: rating = "Excellent (Six Sigma)"
    elif cpk >= 1.33: rating = "Good (capable)"
    elif cpk >= 1.0: rating = "Marginal (barely capable)"
    else: rating = "Poor (not capable)"

    return {
        "cp": round(cp, 3), "cpk": round(cpk, 3),
        "cpu": round(cpu, 3), "cpl": round(cpl, 3),
        "pp": round(pp, 3), "ppk": round(ppk, 3),
        "mean": round(mean, 4), "std_dev": round(std, 4),
        "lsl": lsl, "usl": usl, "target": target,
        "n": len(values),
        "out_of_spec_count": out_of_spec,
        "percent_out_of_spec": round(pct_out, 2),
        "capability_rating": rating,
        "sigma_level": round(cpk * 3, 2),
    }

# ── Trend ────────────────────────────────────────────────────

def trend(data, params):
    values = to_float_array(data)
    n = len(values)
    x = np.arange(n)
    slope, intercept, r, p, se = stats.linregress(x, values)
    threshold = params.get("threshold")
    days_to_threshold = None
    if threshold is not None:
        threshold = float(threshold)
        if slope != 0:
            steps = (threshold - intercept) / slope
            if steps > n:
                days_to_threshold = round(steps - n)

    return {
        "slope": round(float(slope), 6),
        "intercept": round(float(intercept), 4),
        "r_squared": round(float(r**2), 4),
        "p_value": round(float(p), 4),
        "slope_significant": bool(p < 0.05),
        "trend_direction": "increasing" if slope > 0 else "decreasing" if slope < 0 else "flat",
        "trend_strength": "strong" if abs(r) > 0.7 else "moderate" if abs(r) > 0.4 else "weak",
        "n": n,
        "mean": round(float(np.mean(values)), 4),
        "days_to_threshold": days_to_threshold,
    }

# ── Anomaly Detection ────────────────────────────────────────

def anomaly_detection(data, params):
    values = to_float_array(data)
    n = len(values)
    labels = params.get("labels", [str(i) for i in range(n)])
    method = params.get("method", "both")
    z_threshold = float(params.get("threshold", 3.0))
    mean = float(np.mean(values))
    std = float(np.std(values, ddof=1)) if n > 1 else 0.0
    q1 = float(np.percentile(values, 25))
    q3 = float(np.percentile(values, 75))
    iqr = q3 - q1
    lower_iqr = q1 - 1.5 * iqr
    upper_iqr = q3 + 1.5 * iqr
    anomalies = []
    for i, v in enumerate(values):
        v = float(v)
        z = abs((v - mean) / std) if std > 0 else 0.0
        is_zs = bool(z > z_threshold)
        is_iq = bool(v < lower_iqr or v > upper_iqr)
        hit = (method == "zscore" and is_zs) or (method == "iqr" and is_iq) or (method == "both" and (is_zs or is_iq))
        if hit:
            anomalies.append({"index": i, "label": labels[i] if i < len(labels) else str(i), "value": round(v, 4), "z_score": round(z, 2), "is_zscore_anomaly": is_zs, "is_iqr_anomaly": is_iq})
    return {"anomalies": anomalies, "anomaly_count": len(anomalies), "anomaly_rate": round(len(anomalies)/n*100, 1), "mean": round(mean, 4), "std": round(std, 4), "q1": round(q1, 4), "q3": round(q3, 4), "iqr": round(iqr, 4), "lower_bound_iqr": round(lower_iqr, 4), "upper_bound_iqr": round(upper_iqr, 4), "n": n}

# ── Pareto ───────────────────────────────────────────────────

def pareto(data, params):
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
        categories = [str(d.get("category") or d.get("name") or d.get("label") or list(d.values())[0]) for d in data]
        values = [float(d.get("value") or d.get("count") or d.get("frequency") or list(d.values())[-1]) for d in data]
    else:
        categories = params.get("categories", [str(i) for i in range(len(data))])
        values = [float(v) for v in data]

    threshold_pct = float(params.get("threshold_pct", 80))
    total = sum(values)
    paired = sorted(zip(categories, values), key=lambda x: x[1], reverse=True)
    result = []
    cumulative = 0
    vital_few = []
    for cat, val in paired:
        pct = val / total * 100
        cumulative += pct
        item = {
            "category": cat,
            "value": round(val, 2),
            "percentage": round(pct, 1),
            "cumulative_percentage": round(cumulative, 1),
        }
        result.append(item)
        if cumulative <= threshold_pct + pct:
            vital_few.append(cat)

    return {
        "items": result,
        "total": round(total, 2),
        "vital_few": vital_few,
        "vital_few_count": len(vital_few),
        "trivial_many_count": len(result) - len(vital_few),
        "threshold_pct": threshold_pct,
        "top_item": result[0]["category"] if result else None,
        "top_item_pct": result[0]["percentage"] if result else None,
    }

# ── Correlation ──────────────────────────────────────────────

def correlation(data, params):
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
        keys = list(data[0].keys())
        x = np.array([float(d[keys[0]]) for d in data])
        y = np.array([float(d[keys[1]]) for d in data])
        x_label = params.get("x_label", keys[0])
        y_label = params.get("y_label", keys[1])
    else:
        x = np.array([float(v) for v in params.get("x", [])])
        y = np.array([float(v) for v in params.get("y", data)])
        x_label = params.get("x_label", "x")
        y_label = params.get("y_label", "y")

    pearson_r, pearson_p = stats.pearsonr(x, y)
    spearman_r, spearman_p = stats.spearmanr(x, y)
    significant = bool(pearson_p < 0.05)
    strength = "strong" if abs(pearson_r) > 0.7 else "moderate" if abs(pearson_r) > 0.4 else "weak"
    direction = "positive" if pearson_r > 0 else "negative"

    return {
        "x_label": x_label, "y_label": y_label,
        "n": len(x),
        "pearson_r": round(float(pearson_r), 4),
        "pearson_p": round(float(pearson_p), 4),
        "spearman_r": round(float(spearman_r), 4),
        "spearman_p": round(float(spearman_p), 4),
        "significant": significant,
        "relationship_strength": strength,
        "relationship_direction": direction,
        "r_squared": round(float(pearson_r**2), 4),
    }

# ── Weibull ──────────────────────────────────────────────────

def weibull(data, params):
    failure_times = to_float_array(data)
    failure_times = failure_times[failure_times > 0]
    if len(failure_times) < 3:
        raise ValueError("Need at least 3 failure times for Weibull analysis")

    # Fit Weibull using scipy
    shape, loc, scale = stats.weibull_min.fit(failure_times, floc=0)
    beta = float(shape)   # shape parameter
    eta = float(scale)    # scale parameter (characteristic life)

    from math import gamma as _gamma
    mtbf = eta * _gamma(1 + 1/beta)
    b10 = eta * (-np.log(0.90)) ** (1/beta)
    b50 = eta * (-np.log(0.50)) ** (1/beta)

    if beta < 1: failure_mode = "Infant mortality (decreasing failure rate)"
    elif beta < 1.5: failure_mode = "Random failures (constant failure rate)"
    else: failure_mode = "Wear-out (increasing failure rate)"

    # Reliability curve at key time points
    t_points = np.linspace(0, max(failure_times) * 1.5, 20)
    reliability_curve = [
        {"t": round(float(t), 2), "reliability": round(float(np.exp(-(t/eta)**beta)), 4)}
        for t in t_points
    ]

    return {
        "beta": round(beta, 3),
        "eta": round(eta, 3),
        "mtbf": round(mtbf, 2),
        "b10_life": round(float(b10), 2),
        "b50_life": round(float(b50), 2),
        "failure_mode": failure_mode,
        "n_failures": len(failure_times),
        "reliability_curve": reliability_curve,
    }

# ── MTBF / MTTR ──────────────────────────────────────────────

def mtbf(data, params):
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
        failure_times = [float(d.get("failure_timestamp") or d.get("timestamp") or d.get("time") or 0) for d in data]
        repair_durations = [float(d.get("repair_duration") or d.get("duration") or d.get("downtime") or 0) for d in data]
    else:
        failure_times = [float(v) for v in params.get("failure_timestamps", data)]
        repair_durations = [float(v) for v in params.get("repair_durations", [])]

    n = len(failure_times)
    if n < 2:
        raise ValueError("Need at least 2 failure events")

    total_downtime = sum(repair_durations) if repair_durations else 0
    observation_period = float(params.get("observation_period",
        max(failure_times) - min(failure_times) + (total_downtime / n if n else 0)))

    uptime = observation_period - total_downtime
    mtbf_val = uptime / n if n > 0 else 0
    mttr_val = total_downtime / n if n > 0 and total_downtime > 0 else None
    availability = uptime / observation_period * 100 if observation_period > 0 else 100

    return {
        "mtbf": round(mtbf_val, 2),
        "mttr": round(mttr_val, 2) if mttr_val else None,
        "availability_pct": round(availability, 2),
        "total_failures": n,
        "total_downtime": round(total_downtime, 2),
        "uptime": round(uptime, 2),
        "observation_period": round(observation_period, 2),
        "failure_rate": round(n / observation_period, 6) if observation_period > 0 else None,
    }

# ── OEE Decomposition ────────────────────────────────────────

def oee_decomposition(data, params):
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
        d = data[0]
        planned_time = float(d.get("planned_time", params.get("planned_time", 0)))
        run_time = float(d.get("run_time", params.get("run_time", 0)))
        ideal_cycle_time = float(d.get("ideal_cycle_time", params.get("ideal_cycle_time", 0)))
        total_count = float(d.get("total_count", params.get("total_count", 0)))
        good_count = float(d.get("good_count", params.get("good_count", 0)))
    else:
        planned_time = float(params.get("planned_time", 0))
        run_time = float(params.get("run_time", 0))
        ideal_cycle_time = float(params.get("ideal_cycle_time", 0))
        total_count = float(params.get("total_count", 0))
        good_count = float(params.get("good_count", 0))

    availability = run_time / planned_time if planned_time > 0 else 0
    performance = (ideal_cycle_time * total_count) / run_time if run_time > 0 else 0
    quality = good_count / total_count if total_count > 0 else 0
    oee = availability * performance * quality

    benchmark = float(params.get("benchmark_oee", 0.85))
    losses = {
        "availability_loss": round((1 - availability) * 100, 1),
        "performance_loss": round(availability * (1 - performance) * 100, 1),
        "quality_loss": round(availability * performance * (1 - quality) * 100, 1),
    }
    biggest_loss = max(losses, key=losses.get)

    return {
        "oee": round(oee * 100, 1),
        "availability": round(availability * 100, 1),
        "performance": round(performance * 100, 1),
        "quality": round(quality * 100, 1),
        "losses": losses,
        "biggest_loss_driver": biggest_loss,
        "vs_benchmark_pct": round((oee - benchmark) * 100, 1),
        "world_class_85": oee >= 0.85,
    }

# ── Hypothesis Test ──────────────────────────────────────────

def hypothesis_test(data, params):
    group_labels = params.get("group_labels", [f"Group {i+1}" for i in range(len(data))])
    alpha = float(params.get("alpha", 0.05))
    groups = [np.array([float(v) for v in g]) for g in data]
    n_groups = len(groups)

    group_stats = [
        {"label": group_labels[i], "mean": round(float(np.mean(g)), 4),
         "std": round(float(np.std(g, ddof=1)), 4), "n": len(g)}
        for i, g in enumerate(groups)
    ]

    test_type = params.get("test", "auto")
    if test_type == "auto":
        test_type = "ttest" if n_groups == 2 else "anova"

    if test_type == "ttest" and n_groups == 2:
        stat, p = stats.ttest_ind(groups[0], groups[1])
        test_used = "Independent samples t-test"
    else:
        stat, p = stats.f_oneway(*groups)
        test_used = "One-way ANOVA"

    significant = bool(p < alpha)
    means = [g_s["mean"] for g_s in group_stats]
    best = group_labels[means.index(max(means))]
    worst = group_labels[means.index(min(means))]

    conclusion = f"The difference between groups IS statistically significant (p={p:.4f} < {alpha})." if significant         else f"No statistically significant difference detected (p={p:.4f} >= {alpha})."

    return {
        "test_used": test_used,
        "statistic": round(float(stat), 4),
        "p_value": round(float(p), 4),
        "significant": significant,
        "alpha": alpha,
        "group_stats": group_stats,
        "highest_group": best,
        "lowest_group": worst,
        "conclusion": conclusion,
    }

# ── Changepoint Detection ────────────────────────────────────

def changepoint_detection(data, params):
    values = to_float_array(data)
    labels = params.get("labels", [str(i) for i in range(len(values))])
    n = len(values)
    if n < 8:
        raise ValueError("Need at least 8 data points for changepoint detection")

    # CUSUM method
    mean = np.mean(values)
    std = np.std(values, ddof=1)
    if std == 0:
        return {"changepoints": [], "message": "No variation in data"}

    normalized = (values - mean) / std
    cusum_pos = np.zeros(n)
    cusum_neg = np.zeros(n)
    k = float(params.get("sensitivity", 0.5))

    for i in range(1, n):
        cusum_pos[i] = max(0, cusum_pos[i-1] + normalized[i] - k)
        cusum_neg[i] = max(0, cusum_neg[i-1] - normalized[i] - k)

    threshold = 4.0
    changepoints = []
    for i in range(1, n):
        if cusum_pos[i] > threshold or cusum_neg[i] > threshold:
            direction = "upward" if cusum_pos[i] > threshold else "downward"
            if not changepoints or i - changepoints[-1]["index"] > 3:
                before_mean = float(np.mean(values[max(0,i-5):i]))
                after_mean = float(np.mean(values[i:min(n,i+5)]))
                changepoints.append({
                    "index": i,
                    "label": labels[i] if i < len(labels) else str(i),
                    "direction": direction,
                    "magnitude": round(abs(after_mean - before_mean), 4),
                    "before_mean": round(before_mean, 4),
                    "after_mean": round(after_mean, 4),
                })

    return {
        "changepoints": changepoints,
        "changepoint_count": len(changepoints),
        "overall_mean": round(float(mean), 4),
        "overall_std": round(float(std), 4),
        "n": n,
        "most_significant": max(changepoints, key=lambda x: x["magnitude"]) if changepoints else None,
    }

# ── Regression ───────────────────────────────────────────────

def regression(data, params):
    import statsmodels.api as sm
    feature_names = params.get("feature_names", [])
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
        keys = list(data[0].keys())
        y_key = params.get("y_key", keys[-1])
        x_keys = [k for k in keys if k != y_key]
        feature_names = feature_names or x_keys
        y = np.array([float(d[y_key]) for d in data])
        X = np.column_stack([[float(d[k]) for d in data] for k in x_keys])
    else:
        y = np.array([float(v) for v in params.get("y", [])])
        X = np.array(params.get("X", data))

    X_with_const = sm.add_constant(X)
    model = sm.OLS(y, X_with_const).fit()
    coefficients = []
    for i, name in enumerate(["intercept"] + (feature_names or [f"x{j}" for j in range(X.shape[1])])):
        coefficients.append({
            "name": name,
            "value": round(float(model.params[i]), 4),
            "p_value": round(float(model.pvalues[i]), 4),
            "significant": bool(model.pvalues[i] < 0.05),
        })

    return {
        "coefficients": coefficients,
        "r_squared": round(float(model.rsquared), 4),
        "adj_r_squared": round(float(model.rsquared_adj), 4),
        "f_statistic": round(float(model.fvalue), 4),
        "f_p_value": round(float(model.f_pvalue), 4),
        "rmse": round(float(np.sqrt(model.mse_resid)), 4),
        "n": int(model.nobs),
        "significant_predictors": [c["name"] for c in coefficients if c["significant"] and c["name"] != "intercept"],
    }

HANDLERS = {
    "control_chart": control_chart,
    "process_capability": process_capability,
    "trend": trend,
    "anomaly_detection": anomaly_detection,
    "changepoint_detection": changepoint_detection,
    "pareto": pareto,
    "correlation": correlation,
    "weibull": weibull,
    "mtbf": mtbf,
    "oee_decomposition": oee_decomposition,
    "hypothesis_test": hypothesis_test,
    "regression": regression,
}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
