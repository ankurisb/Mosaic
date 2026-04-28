// ─── Mock SAP S/4HANA OData V2 server ─────────────────────────────
// Implements just enough OData V2 to exercise Mosaic's SAP API path:
//   - $filter with eq, ne, gt, ge, lt, le, and 'and'
//   - $select (field projection)
//   - $top / $skip (pagination)
//   - $format=json
//   - { d: { results: [...] } } response envelope (SAP V2 style)
//
// Endpoints:
//   GET  /health
//   GET  /sap/opu/odata/sap/API_PRODUCTION_ORDER_SRV/A_ProductionOrder
//   GET  /sap/opu/odata/sap/API_EQUIPMENT_SRV/Equipment
//   GET  /sap/opu/odata/sap/API_MAINTNOTIFICATION_SRV/MaintenanceNotification
//
// Auth: Bearer token. Any non-empty token accepted (so tests are easy).
//       Set header "Authorization: Bearer testtoken" in Mosaic.

const express = require('express');
const app = express();
const PORT = 4001;

// ─── Sample data ──────────────────────────────────────────────────
// Asset codes aligned with the Postgres machines and MSSQL CMMS assets
// so cross-source queries produce matching joins.

const productionOrders = [
  { ManufacturingOrder: '000010001234', Plant: '1000', MaterialNumber: 'SKU-A100', TotalQuantity: '500.000', ProductionUnit: 'EA', SystemStatus: 'REL', MfgOrderActualStartDate: '/Date(1772064000000)/', MfgOrderPlannedEndDate: '/Date(1772928000000)/', ProductionVersion: '0001' },
  { ManufacturingOrder: '000010001235', Plant: '1000', MaterialNumber: 'SKU-A200', TotalQuantity: '300.000', ProductionUnit: 'EA', SystemStatus: 'REL', MfgOrderActualStartDate: '/Date(1772150400000)/', MfgOrderPlannedEndDate: '/Date(1773014400000)/', ProductionVersion: '0001' },
  { ManufacturingOrder: '000010001236', Plant: '1000', MaterialNumber: 'SKU-B300', TotalQuantity: '150.000', ProductionUnit: 'EA', SystemStatus: 'TECO', MfgOrderActualStartDate: '/Date(1772236800000)/', MfgOrderPlannedEndDate: '/Date(1772841600000)/', ProductionVersion: '0002' },
  { ManufacturingOrder: '000010001237', Plant: '1000', MaterialNumber: 'SKU-B400', TotalQuantity: '200.000', ProductionUnit: 'EA', SystemStatus: 'REL', MfgOrderActualStartDate: '/Date(1772323200000)/', MfgOrderPlannedEndDate: '/Date(1773187200000)/', ProductionVersion: '0001' },
  { ManufacturingOrder: '000010001238', Plant: '2000', MaterialNumber: 'SKU-C500', TotalQuantity: '400.000', ProductionUnit: 'EA', SystemStatus: 'CRTD', MfgOrderActualStartDate: null, MfgOrderPlannedEndDate: '/Date(1773273600000)/', ProductionVersion: '0001' },
  { ManufacturingOrder: '000010001239', Plant: '1000', MaterialNumber: 'SKU-C600', TotalQuantity: '250.000', ProductionUnit: 'EA', SystemStatus: 'REL', MfgOrderActualStartDate: '/Date(1772496000000)/', MfgOrderPlannedEndDate: '/Date(1773360000000)/', ProductionVersion: '0001' },
  { ManufacturingOrder: '000010001240', Plant: '1000', MaterialNumber: 'SKU-A100', TotalQuantity: '600.000', ProductionUnit: 'EA', SystemStatus: 'DLV', MfgOrderActualStartDate: '/Date(1772582400000)/', MfgOrderPlannedEndDate: '/Date(1773187200000)/', ProductionVersion: '0001' },
  { ManufacturingOrder: '000010001241', Plant: '1000', MaterialNumber: 'SKU-B300', TotalQuantity: '100.000', ProductionUnit: 'EA', SystemStatus: 'REL', MfgOrderActualStartDate: '/Date(1772668800000)/', MfgOrderPlannedEndDate: '/Date(1773532800000)/', ProductionVersion: '0002' },
];

const equipment = [
  { Equipment: '10000001', EquipmentName: 'CNC Mill A',        EquipmentCategory: 'M', TechnicalObjectDescription: 'CNC Mill Line A Bay 1',     MaintenancePlant: '1000', Location: 'LINE-A-01', ABCIndicator: 'A', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000002', EquipmentName: 'CNC Mill B',        EquipmentCategory: 'M', TechnicalObjectDescription: 'CNC Mill Line A Bay 2',     MaintenancePlant: '1000', Location: 'LINE-A-02', ABCIndicator: 'A', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000003', EquipmentName: 'CNC Mill C',        EquipmentCategory: 'M', TechnicalObjectDescription: 'CNC Mill Line A Bay 3',     MaintenancePlant: '1000', Location: 'LINE-A-03', ABCIndicator: 'A', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000004', EquipmentName: 'Lathe A',           EquipmentCategory: 'M', TechnicalObjectDescription: 'Lathe Line B Bay 1',        MaintenancePlant: '1000', Location: 'LINE-B-01', ABCIndicator: 'B', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000005', EquipmentName: 'Lathe B',           EquipmentCategory: 'M', TechnicalObjectDescription: 'Lathe Line B Bay 2',        MaintenancePlant: '1000', Location: 'LINE-B-02', ABCIndicator: 'B', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000006', EquipmentName: 'Hydraulic Press',   EquipmentCategory: 'M', TechnicalObjectDescription: 'Hydraulic Press Line B',    MaintenancePlant: '1000', Location: 'LINE-B-03', ABCIndicator: 'A', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000007', EquipmentName: 'Vertical Mill',     EquipmentCategory: 'M', TechnicalObjectDescription: 'Vertical Mill Line C',      MaintenancePlant: '1000', Location: 'LINE-C-01', ABCIndicator: 'B', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000008', EquipmentName: 'Horizontal Mill',   EquipmentCategory: 'M', TechnicalObjectDescription: 'Horizontal Mill Line C',    MaintenancePlant: '1000', Location: 'LINE-C-02', ABCIndicator: 'B', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000009', EquipmentName: 'Assembly Cell 1',   EquipmentCategory: 'M', TechnicalObjectDescription: 'Assembly Cell Line C',      MaintenancePlant: '1000', Location: 'LINE-C-03', ABCIndicator: 'C', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000010', EquipmentName: 'Assembly Cell 2',   EquipmentCategory: 'M', TechnicalObjectDescription: 'Assembly Cell Line C',      MaintenancePlant: '1000', Location: 'LINE-C-04', ABCIndicator: 'C', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000011', EquipmentName: 'HVAC Unit',         EquipmentCategory: 'M', TechnicalObjectDescription: 'Factory HVAC Roof Unit',    MaintenancePlant: '1000', Location: 'UTIL-ROOF', ABCIndicator: 'B', EquipmentIsInStatus: 'INST' },
  { Equipment: '10000012', EquipmentName: 'Air Compressor 1',  EquipmentCategory: 'M', TechnicalObjectDescription: 'Air Compressor Utility',    MaintenancePlant: '1000', Location: 'UTIL-01',   ABCIndicator: 'A', EquipmentIsInStatus: 'INST' },
];

const maintenanceNotifications = [
  // Breakdowns on PRESS-01 (equipment 10000006) — matches CMMS work orders
  { MaintenanceNotification: '100000501', NotificationType: 'M1', NotificationText: 'Hydraulic leak - seal failure',          MaintPriorityCode: '1', TechnicalObject: '10000006', CreationDate: '/Date(1792022400000)/', MalfunctionStartDate: '/Date(1792022400000)/', IsCompleted: true,  NotificationStatus: 'NOCO' },
  { MaintenanceNotification: '100000502', NotificationType: 'M2', NotificationText: 'Dimensional drift on CNC-03',            MaintPriorityCode: '2', TechnicalObject: '10000003', CreationDate: '/Date(1792627200000)/', MalfunctionStartDate: '/Date(1792627200000)/', IsCompleted: true,  NotificationStatus: 'NOCO' },
  { MaintenanceNotification: '100000503', NotificationType: 'M1', NotificationText: 'Pressure loss',                          MaintPriorityCode: '1', TechnicalObject: '10000006', CreationDate: '/Date(1794096000000)/', MalfunctionStartDate: '/Date(1794096000000)/', IsCompleted: true,  NotificationStatus: 'NOCO' },
  { MaintenanceNotification: '100000504', NotificationType: 'M2', NotificationText: 'Control system fault',                   MaintPriorityCode: '2', TechnicalObject: '10000006', CreationDate: '/Date(1796299200000)/', MalfunctionStartDate: '/Date(1796299200000)/', IsCompleted: true,  NotificationStatus: 'NOCO' },
  { MaintenanceNotification: '100000505', NotificationType: 'M2', NotificationText: 'Tool breakage - repeated DIM-01',        MaintPriorityCode: '2', TechnicalObject: '10000003', CreationDate: '/Date(1736812800000)/', MalfunctionStartDate: '/Date(1736812800000)/', IsCompleted: true,  NotificationStatus: 'NOCO' },
  { MaintenanceNotification: '100000506', NotificationType: 'M1', NotificationText: 'Hydraulic seal failure',                 MaintPriorityCode: '1', TechnicalObject: '10000006', CreationDate: '/Date(1738022400000)/', MalfunctionStartDate: '/Date(1738022400000)/', IsCompleted: true,  NotificationStatus: 'NOCO' },
  // Open items
  { MaintenanceNotification: '100000601', NotificationType: 'M2', NotificationText: 'Pressure drop intermittent - diagnostic',MaintPriorityCode: '1', TechnicalObject: '10000006', CreationDate: '/Date(1745312400000)/', MalfunctionStartDate: '/Date(1745312400000)/', IsCompleted: false, NotificationStatus: 'OSNO' },
  { MaintenanceNotification: '100000602', NotificationType: 'M2', NotificationText: 'Dimensional check - recurring DIM-01',   MaintPriorityCode: '2', TechnicalObject: '10000003', CreationDate: '/Date(1745415600000)/', MalfunctionStartDate: '/Date(1745415600000)/', IsCompleted: false, NotificationStatus: 'OSNO' },
  { MaintenanceNotification: '100000603', NotificationType: 'M2', NotificationText: 'Compressor cycling too frequently',      MaintPriorityCode: '2', TechnicalObject: '10000012', CreationDate: '/Date(1745481600000)/', MalfunctionStartDate: '/Date(1745481600000)/', IsCompleted: false, NotificationStatus: 'OSNO' },
  { MaintenanceNotification: '100000604', NotificationType: 'M2', NotificationText: 'HVAC unit intermittent trip',            MaintPriorityCode: '1', TechnicalObject: '10000011', CreationDate: '/Date(1745593200000)/', MalfunctionStartDate: '/Date(1745593200000)/', IsCompleted: false, NotificationStatus: 'OSNO' },
];

// ─── $filter expression parser ────────────────────────────────────
// Supports: field eq|ne|gt|ge|lt|le 'literal' or number, chained with 'and'
function parseFilter(expr) {
  if (!expr) return () => true;
  const clauses = expr.split(/\s+and\s+/i).map(c => c.trim());
  const OPS = {
    eq: (a, b) => String(a) === String(b),
    ne: (a, b) => String(a) !== String(b),
    gt: (a, b) => Number(a) > Number(b) || String(a) > String(b),
    ge: (a, b) => Number(a) >= Number(b) || String(a) >= String(b),
    lt: (a, b) => Number(a) < Number(b) || String(a) < String(b),
    le: (a, b) => Number(a) <= Number(b) || String(a) <= String(b),
  };
  const fns = clauses.map(c => {
    const m = c.match(/^(\w+)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i);
    if (!m) return () => true;
    const [, field, op, rawVal] = m;
    let val = rawVal.trim();
    if ((val.startsWith("'") && val.endsWith("'")) ||
        (val.startsWith('"') && val.endsWith('"'))) val = val.slice(1, -1);
    val = val.replace(/''/g, "'");
    const fn = OPS[op.toLowerCase()];
    return (row) => fn(row[field], val);
  });
  return (row) => fns.every(f => f(row));
}

function applyOData(rows, req) {
  let out = rows;
  const $filter = req.query.$filter;
  const $select = req.query.$select;
  const $top    = req.query.$top    ? parseInt(req.query.$top, 10)  : null;
  const $skip   = req.query.$skip   ? parseInt(req.query.$skip, 10) : 0;

  if ($filter) {
    try { out = out.filter(parseFilter($filter)); }
    catch (e) { throw new Error(`Invalid $filter: ${$filter}`); }
  }
  if ($skip)           out = out.slice($skip);
  if ($top != null)    out = out.slice(0, $top);
  if ($select) {
    const fields = $select.split(',').map(s => s.trim());
    out = out.map(r => Object.fromEntries(fields.map(f => [f, r[f]])));
  }
  return out;
}

function envelope(results) {
  return { d: { results } };
}

// ─── Auth middleware (loose) ──────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const auth = req.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') && !auth.startsWith('Basic ') && !req.query.__noauth) {
    return res.status(401).json({ error: { code: '401', message: { value: 'Authorization header required (Bearer or Basic). Set "Authorization: Bearer testtoken" in Mosaic.' } } });
  }
  next();
});

// ─── Request logging ──────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mock-sap-odata', entities: ['A_ProductionOrder','Equipment','MaintenanceNotification'] });
});

// Production Orders
app.get('/sap/opu/odata/sap/API_PRODUCTION_ORDER_SRV/A_ProductionOrder', (req, res) => {
  try { res.json(envelope(applyOData(productionOrders, req))); }
  catch (e) { res.status(400).json({ error: { code: '400', message: { value: e.message } } }); }
});

// Equipment
app.get('/sap/opu/odata/sap/API_EQUIPMENT_SRV/Equipment', (req, res) => {
  try { res.json(envelope(applyOData(equipment, req))); }
  catch (e) { res.status(400).json({ error: { code: '400', message: { value: e.message } } }); }
});

// Maintenance Notifications
app.get('/sap/opu/odata/sap/API_MAINTNOTIFICATION_SRV/MaintenanceNotification', (req, res) => {
  try { res.json(envelope(applyOData(maintenanceNotifications, req))); }
  catch (e) { res.status(400).json({ error: { code: '400', message: { value: e.message } } }); }
});

// OData service document (lightweight)
app.get('/sap/opu/odata/sap/:service', (req, res) => {
  res.json({
    d: {
      EntitySets: ['A_ProductionOrder', 'Equipment', 'MaintenanceNotification']
    }
  });
});

// Fallback
app.use((req, res) => {
  res.status(404).json({ error: { code: '404', message: { value: `No such entity: ${req.path}` } } });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock SAP OData server listening on :${PORT}`);
  console.log('Try: curl -H "Authorization: Bearer testtoken" \\');
  console.log(`  "http://localhost:${PORT}/sap/opu/odata/sap/API_EQUIPMENT_SRV/Equipment?\\$top=3&\\$format=json"`);
});
