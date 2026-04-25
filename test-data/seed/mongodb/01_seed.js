// ─── MongoDB: Event Logs ────────────────────────────────────────
// Semi-structured machine event documents. Nested fields exercise
// Mosaic's JSON filter query path.

db = db.getSiblingDB('event_logs');

db.createUser({
  user: 'mosaic',
  pwd: 'mosaic_pw',
  roles: [{ role: 'readWrite', db: 'event_logs' }]
});

db.machine_events.drop();
db.machine_events.createIndex({ machine: 1, timestamp: -1 });
db.machine_events.createIndex({ severity: 1 });

const now = new Date('2026-04-22T12:00:00Z');
const hoursAgo = (h) => new Date(now.getTime() - h*3600*1000);

db.machine_events.insertMany([
  {
    machine: 'PRESS-01',
    event_type: 'alarm',
    severity: 'critical',
    timestamp: hoursAgo(51),  // 2026-04-20 09:00
    source_system: 'PLC',
    details: {
      alarm_code: 'PR-001',
      alarm_desc: 'Hydraulic pressure below setpoint',
      setpoint_bar: 185,
      actual_bar: 142,
      duration_s: 900
    },
    operator: { code: 'E1003', name: 'Ahmed Hassan' },
    resolved: true,
    resolved_at: hoursAgo(48.5)
  },
  {
    machine: 'PRESS-01',
    event_type: 'state_change',
    severity: 'info',
    timestamp: hoursAgo(50.75),
    source_system: 'SCADA',
    details: { from: 'running', to: 'stopped', reason: 'operator_halt' },
    operator: { code: 'E1003', name: 'Ahmed Hassan' }
  },
  {
    machine: 'PRESS-01',
    event_type: 'state_change',
    severity: 'info',
    timestamp: hoursAgo(48.5),
    source_system: 'SCADA',
    details: { from: 'maintenance', to: 'running', reason: 'post_repair' }
  },
  {
    machine: 'CNC-03',
    event_type: 'alarm',
    severity: 'warning',
    timestamp: hoursAgo(30),
    source_system: 'PLC',
    details: {
      alarm_code: 'VIB-012',
      alarm_desc: 'Vibration exceeds threshold',
      threshold_mm_s: 2.5,
      actual_mm_s: 2.9,
      axis: 'spindle'
    }
  },
  {
    machine: 'CNC-03',
    event_type: 'quality_alert',
    severity: 'warning',
    timestamp: hoursAgo(26),
    source_system: 'QMS',
    details: {
      defect_code: 'DIM-01',
      batch: 'B20260421-147',
      reject_count: 4,
      sample_size: 30
    }
  },
  {
    machine: 'HVAC-01',
    event_type: 'alarm',
    severity: 'warning',
    timestamp: hoursAgo(4.5),
    source_system: 'BMS',
    details: {
      alarm_code: 'HV-008',
      alarm_desc: 'Compressor cycling abnormal',
      cycles_per_hour: 22,
      normal_cph: 8
    }
  },
  {
    machine: 'CNC-01',
    event_type: 'tool_change',
    severity: 'info',
    timestamp: hoursAgo(8),
    source_system: 'CNC',
    details: { tool_id: 'T-42', part_number: 'SP-TL-001', planned: true }
  },
  {
    machine: 'MILL-02',
    event_type: 'production_complete',
    severity: 'info',
    timestamp: hoursAgo(2),
    source_system: 'MES',
    details: { batch: 'B20260422-201', units: 62, duration_min: 485 }
  },
  {
    machine: 'LATHE-01',
    event_type: 'alarm',
    severity: 'info',
    timestamp: hoursAgo(12),
    source_system: 'PLC',
    details: { alarm_code: 'LU-003', alarm_desc: 'Lubricator low - auto-refilled' },
    resolved: true
  },
  {
    machine: 'PRESS-01',
    event_type: 'maintenance',
    severity: 'info',
    timestamp: hoursAgo(45),
    source_system: 'CMMS',
    details: {
      wo_number: 'WO-2026-0102',
      task: 'Hydraulic seal replacement',
      parts_used: [{ part: 'SP-HS-001', qty: 1 }],
      technician: 'David Lee',
      duration_min: 210
    }
  }
]);

print('Seeded event_logs.machine_events: ' + db.machine_events.countDocuments() + ' documents');
