USE cmms;
GO

-- ── Assets (deliberately shares codes with Postgres machines) ──
INSERT INTO dbo.assets(asset_code,description,location,criticality,install_date) VALUES
 ('CNC-01','CNC Mill A','Line A - Bay 1','high','2019-03-15'),
 ('CNC-02','CNC Mill B','Line A - Bay 2','high','2020-07-22'),
 ('CNC-03','CNC Mill C','Line A - Bay 3','high','2022-01-10'),
 ('LATHE-01','Lathe A','Line B - Bay 1','medium','2018-11-05'),
 ('LATHE-02','Lathe B','Line B - Bay 2','medium','2021-05-18'),
 ('PRESS-01','Hydraulic Press','Line B - Bay 3','high','2017-02-28'),
 ('MILL-01','Vertical Mill','Line C - Bay 1','medium','2020-09-14'),
 ('MILL-02','Horizontal Mill','Line C - Bay 2','medium','2023-04-02'),
 ('ASM-01','Assembly Cell 1','Line C - Bay 3','low','2019-08-11'),
 ('ASM-02','Assembly Cell 2','Line C - Bay 4','low','2022-11-29'),
 ('HVAC-01','HVAC Unit - Factory Floor','Roof','medium','2018-05-20'),
 ('COMP-01','Air Compressor 1','Utility Room','high','2019-02-14');

-- ── Technicians ───────────────────────────────────────────────
INSERT INTO dbo.technicians(emp_code,full_name,skill_level) VALUES
 ('T2001','David Lee','senior'),
 ('T2002','Fatima Khan','senior'),
 ('T2003','Carlos Rodriguez','mid'),
 ('T2004','Elena Petrova','mid'),
 ('T2005','Kwame Asante','junior'),
 ('T2006','Rina Tanaka','mid');

-- ── Spare parts ───────────────────────────────────────────────
INSERT INTO dbo.spare_parts(part_number,description,stock_qty,min_stock,unit_cost) VALUES
 ('SP-HS-001','Hydraulic seal kit 50mm',8,5,145.00),
 ('SP-HS-002','Hydraulic seal kit 75mm',3,5,210.00),   -- below min
 ('SP-BR-001','Spindle bearing NSK 6205',12,8,85.50),
 ('SP-BR-002','Spindle bearing NSK 6305',4,8,125.00),  -- below min
 ('SP-FL-001','Air filter C27-580',24,10,42.00),
 ('SP-TL-001','Carbide insert CNMG120408',48,20,12.50),
 ('SP-TL-002','Drill bit HSS 10mm',30,15,8.75),
 ('SP-BL-001','V-belt XPA 1400',6,4,28.00);

-- ── Work orders (mix of open, in-progress, completed) ────────
INSERT INTO dbo.work_orders(wo_number,asset_id,wo_type,priority,status,raised_date,due_date,completed_date,assigned_to,description) VALUES
 -- Completed historical
 ('WO-2025-0501',6,'Breakdown','urgent','closed','2025-10-15 08:30','2025-10-15 18:00','2025-10-15 16:20',1,'Hydraulic leak - replaced 50mm seal kit'),
 ('WO-2025-0502',3,'Corrective','high','closed','2025-10-22 14:00','2025-10-23 18:00','2025-10-23 12:40',2,'Dimensional drift on CNC-03 - recalibrated axes'),
 ('WO-2025-0503',6,'Breakdown','urgent','closed','2025-11-08 06:15','2025-11-08 18:00','2025-11-08 20:45',1,'Pressure loss - replaced pressure relief valve'),
 ('WO-2025-0504',1,'PM','low','closed','2025-11-15 09:00','2025-11-16 17:00','2025-11-15 15:30',3,'Monthly PM - lubrication, coolant top-up'),
 ('WO-2025-0505',6,'Corrective','high','closed','2025-12-03 11:00','2025-12-04 17:00','2025-12-04 14:15',1,'Control system fault - firmware update'),
 ('WO-2025-0506',11,'PM','medium','closed','2025-12-10 08:00','2025-12-10 17:00','2025-12-10 13:00',4,'Quarterly HVAC filter replacement'),
 ('WO-2026-0101',3,'Corrective','high','closed','2026-01-14 10:00','2026-01-15 17:00','2026-01-15 11:20',2,'Tool breakage - repeated DIM-01 defects. Replaced tool and verified'),
 ('WO-2026-0102',6,'Breakdown','urgent','closed','2026-01-28 07:00','2026-01-28 18:00','2026-01-28 22:10',1,'Hydraulic seal failure - 2nd time this quarter'),

 -- In progress
 ('WO-2026-0201',6,'Corrective','high','in_progress','2026-04-18 09:00','2026-04-21 17:00',NULL,1,'Pressure drop intermittent - diagnostic needed'),
 ('WO-2026-0202',3,'Inspection','medium','in_progress','2026-04-19 14:00','2026-04-22 17:00',NULL,2,'Dimensional check - recurring DIM-01'),
 ('WO-2026-0203',12,'Corrective','medium','in_progress','2026-04-20 08:00','2026-04-23 17:00',NULL,4,'Compressor cycling too frequently'),

 -- Open
 ('WO-2026-0301',6,'PM','medium','open','2026-04-22 09:00','2026-04-28 17:00',NULL,NULL,'Monthly PM overdue on PRESS-01'),
 ('WO-2026-0302',4,'PM','low','open','2026-04-22 10:00','2026-04-30 17:00',NULL,NULL,'Quarterly lathe alignment check'),
 ('WO-2026-0303',8,'PM','low','open','2026-04-22 10:30','2026-04-30 17:00',NULL,NULL,'Annual MILL-02 full service'),
 ('WO-2026-0304',1,'Inspection','medium','open','2026-04-23 08:00','2026-04-26 17:00',NULL,NULL,'Vibration check - operator report'),
 ('WO-2026-0305',11,'Corrective','high','open','2026-04-23 11:00','2026-04-24 17:00',NULL,NULL,'HVAC unit intermittent trip');

-- ── PM schedules ──────────────────────────────────────────────
INSERT INTO dbo.pm_schedules(asset_id,frequency_days,last_done,next_due,task) VALUES
 (1,30,'2026-03-20','2026-04-19','Monthly lube + coolant'),
 (2,30,'2026-03-22','2026-04-21','Monthly lube + coolant'),
 (3,30,'2026-03-25','2026-04-24','Monthly lube + axis calibration'),
 (4,90,'2026-01-30','2026-04-30','Quarterly alignment'),
 (5,90,'2026-02-05','2026-05-05','Quarterly alignment'),
 (6,30,'2026-03-15','2026-04-14','Monthly hydraulic inspection'),  -- overdue
 (7,90,'2026-02-15','2026-05-15','Quarterly mill service'),
 (8,365,'2025-06-01','2026-06-01','Annual full service'),
 (11,90,'2026-01-20','2026-04-20','Quarterly HVAC filter'),         -- overdue
 (12,60,'2026-02-28','2026-04-29','Bi-monthly compressor check');
GO
