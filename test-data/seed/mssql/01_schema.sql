-- ─── Maintenance CMMS schema ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'cmms')
    CREATE DATABASE cmms;
GO

USE cmms;
GO

IF OBJECT_ID('dbo.work_orders', 'U') IS NOT NULL DROP TABLE dbo.work_orders;
IF OBJECT_ID('dbo.spare_parts', 'U') IS NOT NULL DROP TABLE dbo.spare_parts;
IF OBJECT_ID('dbo.technicians', 'U') IS NOT NULL DROP TABLE dbo.technicians;
IF OBJECT_ID('dbo.assets',      'U') IS NOT NULL DROP TABLE dbo.assets;
IF OBJECT_ID('dbo.pm_schedules','U') IS NOT NULL DROP TABLE dbo.pm_schedules;
GO

CREATE TABLE dbo.assets (
    id              INT IDENTITY PRIMARY KEY,
    asset_code      NVARCHAR(30) UNIQUE NOT NULL,     -- e.g. 'CNC-01' matches plant.machines
    description     NVARCHAR(200) NOT NULL,
    location        NVARCHAR(100),
    criticality     NVARCHAR(10) NOT NULL DEFAULT 'medium',   -- low / medium / high
    install_date    DATE
);

CREATE TABLE dbo.technicians (
    id              INT IDENTITY PRIMARY KEY,
    emp_code        NVARCHAR(20) UNIQUE NOT NULL,
    full_name       NVARCHAR(100) NOT NULL,
    skill_level     NVARCHAR(20) DEFAULT 'mid'         -- junior / mid / senior
);

CREATE TABLE dbo.work_orders (
    id              INT IDENTITY PRIMARY KEY,
    wo_number       NVARCHAR(20) UNIQUE NOT NULL,
    asset_id        INT NOT NULL REFERENCES dbo.assets(id),
    wo_type         NVARCHAR(20) NOT NULL,             -- PM / Corrective / Breakdown / Inspection
    priority        NVARCHAR(10) NOT NULL,             -- low / medium / high / urgent
    status          NVARCHAR(20) NOT NULL,             -- open / in_progress / completed / closed
    raised_date     DATETIME NOT NULL,
    due_date        DATETIME,
    completed_date  DATETIME,
    assigned_to     INT REFERENCES dbo.technicians(id),
    description     NVARCHAR(500)
);

CREATE INDEX ix_wo_asset  ON dbo.work_orders(asset_id, raised_date);
CREATE INDEX ix_wo_status ON dbo.work_orders(status);

CREATE TABLE dbo.spare_parts (
    id              INT IDENTITY PRIMARY KEY,
    part_number     NVARCHAR(30) UNIQUE NOT NULL,
    description     NVARCHAR(200) NOT NULL,
    stock_qty       INT NOT NULL DEFAULT 0,
    min_stock       INT NOT NULL DEFAULT 5,
    unit_cost       DECIMAL(10,2)
);

CREATE TABLE dbo.pm_schedules (
    id              INT IDENTITY PRIMARY KEY,
    asset_id        INT NOT NULL REFERENCES dbo.assets(id),
    frequency_days  INT NOT NULL,
    last_done       DATE,
    next_due        DATE,
    task            NVARCHAR(200)
);
GO
