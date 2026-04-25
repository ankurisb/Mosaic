-- ─── ERP Lite: customers, orders, products, inventory ───────────────
-- Intentionally different domain from Postgres so Mosaic has to pick
-- the right DB by matching entity names to the connection label.

USE erp_lite;

CREATE TABLE customers (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    code            VARCHAR(20) UNIQUE NOT NULL,
    company_name    VARCHAR(200) NOT NULL,
    country         VARCHAR(3) NOT NULL,
    credit_limit    DECIMAL(12,2) DEFAULT 0,
    active          BOOLEAN DEFAULT TRUE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE suppliers (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    code            VARCHAR(20) UNIQUE NOT NULL,
    name            VARCHAR(200) NOT NULL,
    country         VARCHAR(3) NOT NULL,
    lead_time_days  INT DEFAULT 14
) ENGINE=InnoDB;

CREATE TABLE products (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    sku             VARCHAR(30) UNIQUE NOT NULL,
    name            VARCHAR(200) NOT NULL,
    category        VARCHAR(50),
    unit_price      DECIMAL(10,2) NOT NULL,
    supplier_id     INT,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB;

CREATE TABLE inventory (
    product_id      INT PRIMARY KEY,
    warehouse       VARCHAR(10) NOT NULL,
    qty_on_hand     INT NOT NULL DEFAULT 0,
    qty_reserved    INT NOT NULL DEFAULT 0,
    reorder_point   INT NOT NULL DEFAULT 10,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE orders (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    order_number    VARCHAR(30) UNIQUE NOT NULL,
    customer_id     INT NOT NULL,
    order_date      DATE NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'open',
    total_amount    DECIMAL(12,2) DEFAULT 0,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    INDEX ix_orders_date (order_date),
    INDEX ix_orders_cust (customer_id, order_date)
) ENGINE=InnoDB;

CREATE TABLE order_lines (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    order_id        INT NOT NULL,
    product_id      INT NOT NULL,
    qty             INT NOT NULL,
    unit_price      DECIMAL(10,2) NOT NULL,
    line_total      DECIMAL(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

-- ── Customers ────────────────────────────────────────────────────
INSERT INTO customers(code,company_name,country,credit_limit) VALUES
 ('C001','Northwind GmbH','DEU',50000),
 ('C002','Pacific Rim Ltd','JPN',75000),
 ('C003','Acme Corp','USA',120000),
 ('C004','Maple Industries','CAN',35000),
 ('C005','Tata Systems','IND',90000),
 ('C006','Nordic AB','SWE',45000),
 ('C007','Southern Cross Pty','AUS',60000),
 ('C008','Brasil Tech SA','BRA',40000),
 ('C009','Emirates Holdings','ARE',85000),
 ('C010','Shanghai Works','CHN',150000);

-- ── Suppliers ────────────────────────────────────────────────────
INSERT INTO suppliers(code,name,country,lead_time_days) VALUES
 ('S001','Bosch Electronics','DEU',21),
 ('S002','Mitsubishi Materials','JPN',35),
 ('S003','Stanley Tools','USA',14),
 ('S004','Sandvik Tooling','SWE',28),
 ('S005','Tata Steel','IND',42);

-- ── Products ─────────────────────────────────────────────────────
INSERT INTO products(sku,name,category,unit_price,supplier_id) VALUES
 ('SKU-A100','Precision Shaft A','Shafts',45.50,2),
 ('SKU-A200','Precision Shaft B','Shafts',52.00,2),
 ('SKU-B300','Housing Assembly 300','Housings',128.75,1),
 ('SKU-B400','Housing Assembly 400','Housings',145.00,1),
 ('SKU-C500','Gear Set 500','Gears',89.25,4),
 ('SKU-C600','Gear Set 600','Gears',102.50,4),
 ('SKU-D700','Bearing Kit','Bearings',34.00,5),
 ('SKU-D800','Seal Kit','Seals',18.50,3);

-- ── Inventory ────────────────────────────────────────────────────
INSERT INTO inventory(product_id,warehouse,qty_on_hand,qty_reserved,reorder_point) VALUES
 (1,'WH-01',420,85,100),(2,'WH-01',312,40,100),
 (3,'WH-02',88,20,50),(4,'WH-02',45,12,50),       -- low on SKU-B400
 (5,'WH-01',260,55,80),(6,'WH-01',190,30,80),
 (7,'WH-03',1200,200,300),(8,'WH-03',850,90,200);

-- ── Orders (last 3 months) ───────────────────────────────────────
-- Generated in shell loop below would be ugly in plain SQL; here's a
-- reasonable sample the queries can exercise.
INSERT INTO orders(order_number,customer_id,order_date,status,total_amount) VALUES
 ('ORD-2026-0001',1,'2026-01-15','shipped',5450.00),
 ('ORD-2026-0002',3,'2026-01-22','shipped',12875.00),
 ('ORD-2026-0003',5,'2026-02-03','shipped',8925.50),
 ('ORD-2026-0004',2,'2026-02-10','shipped',6720.00),
 ('ORD-2026-0005',7,'2026-02-14','shipped',4512.50),
 ('ORD-2026-0006',3,'2026-02-21','shipped',18340.00),
 ('ORD-2026-0007',10,'2026-03-01','shipped',22100.00),
 ('ORD-2026-0008',1,'2026-03-08','shipped',3980.00),
 ('ORD-2026-0009',6,'2026-03-12','open',    7250.00),
 ('ORD-2026-0010',9,'2026-03-18','open',   15400.00),
 ('ORD-2026-0011',4,'2026-03-22','open',    2890.00),
 ('ORD-2026-0012',8,'2026-04-01','open',    4100.00),
 ('ORD-2026-0013',3,'2026-04-05','open',    9825.00),
 ('ORD-2026-0014',5,'2026-04-10','open',   11700.00),
 ('ORD-2026-0015',2,'2026-04-14','open',    5400.00);

-- ── Order lines ──────────────────────────────────────────────────
INSERT INTO order_lines(order_id,product_id,qty,unit_price) VALUES
 (1,1,100,45.50),(1,7,25,34.00),
 (2,3,50,128.75),(2,4,45,145.00),
 (3,5,60,89.25),(3,6,36,102.50),
 (4,1,80,52.00),(4,2,40,52.00),
 (5,7,120,34.00),(5,8,30,18.50),
 (6,3,80,128.75),(6,4,60,145.00),
 (7,5,150,89.25),(7,6,85,102.50),
 (8,2,40,52.00),(8,8,100,18.50),
 (9,1,80,45.50),(9,5,40,89.25),
 (10,3,60,128.75),(10,4,50,145.00),
 (11,7,60,34.00),(11,8,50,18.50),
 (12,1,40,45.50),(12,7,70,34.00),
 (13,5,70,89.25),(13,6,35,102.50),
 (14,3,40,128.75),(14,4,45,145.00),
 (15,2,50,52.00),(15,8,160,18.50);
