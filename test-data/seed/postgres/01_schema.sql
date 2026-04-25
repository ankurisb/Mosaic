-- ─── Plant Operations schema ────────────────────────────────────────
-- Domain: manufacturing shop floor. Mirrors the sandbox DB so you can
-- test cross-source queries and smart DB selection.

CREATE SCHEMA IF NOT EXISTS plant;
SET search_path TO plant, public;

CREATE TABLE machines (
    id              SERIAL PRIMARY KEY,
    code            TEXT UNIQUE NOT NULL,        -- e.g. 'CNC-01'
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,               -- CNC, Lathe, Press, Milling, Assembly
    line            TEXT NOT NULL,               -- Line A / Line B / Line C
    plant_code      TEXT NOT NULL DEFAULT '1000',
    commissioned_at DATE,
    status          TEXT NOT NULL DEFAULT 'active',  -- active, maintenance, retired
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE operators (
    id              SERIAL PRIMARY KEY,
    employee_code   TEXT UNIQUE NOT NULL,
    full_name       TEXT NOT NULL,
    shift_pref      TEXT,                         -- Shift 1 / 2 / 3
    certified_types TEXT[]                        -- ['CNC','Lathe']
);

CREATE TABLE shifts (
    id              SERIAL PRIMARY KEY,
    name            TEXT UNIQUE NOT NULL,         -- Shift 1, 2, 3
    starts_at       TIME NOT NULL,
    ends_at         TIME NOT NULL
);

CREATE TABLE production_runs (
    id              BIGSERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(id),
    operator_id     INT REFERENCES operators(id),
    shift           TEXT NOT NULL,
    run_date        DATE NOT NULL,
    product_code    TEXT NOT NULL,
    units_target    INT NOT NULL,
    units_produced  INT NOT NULL,
    units_rejected  INT NOT NULL DEFAULT 0,
    cycle_time_s    NUMERIC(6,2),
    oee_pct         NUMERIC(5,2),                 -- 0-100
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ix_prod_runs_date     ON production_runs(run_date);
CREATE INDEX ix_prod_runs_machine  ON production_runs(machine_id, run_date);

CREATE TABLE downtime_events (
    id              BIGSERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(id),
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    duration_min    INT,
    category        TEXT NOT NULL,                -- Planned / Unplanned
    reason_code     TEXT NOT NULL,                -- tool_change / material / jam / breakdown / pm
    reason_detail   TEXT,
    reported_by     INT REFERENCES operators(id)
);

CREATE INDEX ix_downtime_machine_started ON downtime_events(machine_id, started_at);

CREATE TABLE quality_defects (
    id              BIGSERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(id),
    check_date      DATE NOT NULL,
    batch_code      TEXT NOT NULL,
    defect_code     TEXT NOT NULL,                -- DIM-01, VIS-02, FUNC-03 ...
    defect_category TEXT NOT NULL,                -- Dimensional / Visual / Functional
    count           INT NOT NULL,
    inspector       TEXT
);

CREATE INDEX ix_defects_date     ON quality_defects(check_date);
CREATE INDEX ix_defects_machine  ON quality_defects(machine_id, check_date);

-- Handy view: daily OEE per machine
CREATE OR REPLACE VIEW v_daily_oee AS
SELECT
    m.code AS machine,
    m.line,
    pr.run_date,
    ROUND(AVG(pr.oee_pct), 2) AS avg_oee,
    SUM(pr.units_produced)    AS units,
    SUM(pr.units_rejected)    AS rejects
FROM production_runs pr
JOIN machines m ON m.id = pr.machine_id
GROUP BY m.code, m.line, pr.run_date;
