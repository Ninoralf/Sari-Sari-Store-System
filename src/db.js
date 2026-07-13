import crypto from "node:crypto";
import bcrypt from "bcrypt";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { seedInventoryItems, seedSales } from "./seedData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "..", "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const configuredDbPath = String(process.env.STORE_DB_PATH || "").trim();
const dbPath = configuredDbPath
  ? (path.isAbsolute(configuredDbPath) ? configuredDbPath : path.join(__dirname, "..", configuredDbPath))
  : path.join(dataDir, "store.db");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
export const db = new DatabaseSync(dbPath);
const envFilePath = path.join(__dirname, "..", ".env");
const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
const LOGIN_RATE_LIMIT_BLOCK_MS = 10 * 60 * 1000;
const LOGIN_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ACCOUNT_MAX_ATTEMPTS = 5;
const LOGIN_ACCOUNT_LOCK_MS = 15 * 60 * 1000;

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function getTodayDate() {
  return new Date();
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function startOfDay(value = getTodayDate()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function shiftDate(date, amount) {
  const next = startOfDay(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function withTransaction(callback) {
  return (...args) => {
    db.exec("BEGIN");
    try {
      const result = callback(...args);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
}

export function hashPassword(password) {
  return bcrypt.hash(String(password || ""), 12);
}

export function verifyPassword(password, stored) {
  if (!stored) return Promise.resolve(false);
  return bcrypt.compare(String(password || ""), stored);
}

export function hashPin(pin) {
  return hashPassword(pin);
}

export function verifyPin(pin, stored) {
  return verifyPassword(pin, stored);
}

function normalizeItemStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "low stock" || normalized === "low-stock") return "Low Stock";
  if (normalized === "out of stock" || normalized === "out-of-stock") return "Out of Stock";
  return "In Stock";
}

function deriveLegacyStatus(stockQuantity, reorderLevel) {
  if (stockQuantity <= 0) return "Out of Stock";
  if (stockQuantity <= reorderLevel) return "Low Stock";
  return "In Stock";
}

const defaultEloadNetworks = {
  TM: ["EZ50", "ASTIG99", "ALLNET20", "EASYSURF50"],
  GLOBE: ["GO59", "GO+99", "GOUNLI129", "SURF4ALL99"],
  SMART: ["ALL DATA 50", "MAGICSARAP99", "POWER ALL 99", "GIGA VIDEO 99"],
  TNT: ["TNT PANALO 30", "SURFSAYA 50", "ALL DATA 99", "SAYA ALL 99"],
  SUN: ["CTC50", "TU200", "SURF50", "UNLI TXT 50"],
  DITO: ["DITO 10", "DITO 50", "LEVEL-UP 99", "UNLI 5G 149"]
};

function parsePromoSellingPrice(promoName) {
  const matches = String(promoName || "").match(/(\d+(?:\.\d+)?)/g);
  return matches ? Number(matches[matches.length - 1]) : 0;
}

function createSchema() {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Admin',
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      pin_hash TEXT NOT NULL DEFAULT '',
      must_change_password INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      supplier TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'In Stock',
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_code TEXT NOT NULL UNIQUE,
      sale_date TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      employee_name TEXT NOT NULL DEFAULT 'System',
      total_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS sale_digital_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      service_type TEXT NOT NULL DEFAULT 'eload',
      request_code TEXT NOT NULL DEFAULT '',
      mobile_number TEXT NOT NULL DEFAULT '',
      network TEXT NOT NULL DEFAULT '',
      load_type TEXT NOT NULL DEFAULT '',
      load_value TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      price REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS Products_Log (
      Log_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Transaction_Code TEXT NOT NULL,
      Total_Amount REAL NOT NULL DEFAULT 0,
      Emp_Mng TEXT NOT NULL DEFAULT '',
      Sale_Date TEXT NOT NULL,
      Time_Stamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS Selling_Log_Items (
      Log_Item_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Log_ID INTEGER NOT NULL,
      Product_ID INTEGER NOT NULL,
      Item_Name TEXT NOT NULL DEFAULT '',
      Quantity INTEGER NOT NULL DEFAULT 0,
      Selling_Price REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (Log_ID) REFERENCES Products_Log(Log_ID) ON DELETE CASCADE,
      FOREIGN KEY (Product_ID) REFERENCES inventory_items(id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS GCash_Log (
      Log_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Transaction_Code TEXT NOT NULL,
      Number TEXT NOT NULL DEFAULT '',
      Reference_No TEXT NOT NULL DEFAULT '',
      Cash_IN_OUT TEXT NOT NULL DEFAULT 'IN',
      Amount REAL NOT NULL DEFAULT 0,
      Emp_Mng TEXT NOT NULL DEFAULT '',
      Sale_Date TEXT NOT NULL,
      Time_Stamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ELoad_Log (
      Log_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Transaction_Code TEXT NOT NULL,
      Number TEXT NOT NULL DEFAULT '',
      Network TEXT NOT NULL DEFAULT '',
      Item_Name TEXT NOT NULL DEFAULT '',
      Amount REAL NOT NULL DEFAULT 0,
      Emp_Mng TEXT NOT NULL DEFAULT '',
      Sale_Date TEXT NOT NULL,
      Time_Stamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS digital_service_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_code TEXT NOT NULL UNIQUE,
      service_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      mobile_number TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      request_kind TEXT NOT NULL DEFAULT '',
      network TEXT NOT NULL DEFAULT '',
      load_type TEXT NOT NULL DEFAULT '',
      load_value TEXT NOT NULL DEFAULT '',
      reference_no TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      requested_by_user_id INTEGER,
      requested_by_name TEXT NOT NULL DEFAULT '',
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_by_user_id INTEGER,
      completed_by_name TEXT NOT NULL DEFAULT '',
      completed_at TEXT,
      failed_reason TEXT NOT NULL DEFAULT '',
      failed_by_user_id INTEGER,
      failed_by_name TEXT NOT NULL DEFAULT '',
      failed_at TEXT,
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (failed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_name TEXT NOT NULL,
      store_address TEXT NOT NULL,
      contact_number TEXT NOT NULL,
      tax_id TEXT,
      operating_hours TEXT NOT NULL,
      low_stock_alert INTEGER NOT NULL DEFAULT 1,
      out_of_stock_alert INTEGER NOT NULL DEFAULT 1,
      daily_sales_alert INTEGER NOT NULL DEFAULT 1,
      weekly_sales_alert INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      supplier_id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT NOT NULL UNIQUE,
      contact_no TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS categories (
      category_id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS eload_networks (
      network_id INTEGER PRIMARY KEY AUTOINCREMENT,
      network_name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS eload_promos (
      promo_id INTEGER PRIMARY KEY AUTOINCREMENT,
      network_id INTEGER NOT NULL,
      promo_name TEXT NOT NULL,
      selling_price REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(network_id, promo_name),
      FOREIGN KEY (network_id) REFERENCES eload_networks(network_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS user_login_security (
      username TEXT PRIMARY KEY,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      first_failed_at INTEGER,
      locked_until INTEGER
    );
    CREATE TABLE IF NOT EXISTS login_rate_limits (
      rate_key TEXT PRIMARY KEY,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      window_started_at INTEGER NOT NULL,
      blocked_until INTEGER
    );
  `);
}

function readEnvValue(name) {
  if (!fs.existsSync(envFilePath)) return "";
  const lines = fs.readFileSync(envFilePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (key !== name) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }

  return "";
}

function getSeedAdminPassword() {
  const configuredPassword = String(
    process.env.ADMIN_PASSWORD
    || process.env.DEFAULT_ADMIN_PASSWORD
    || readEnvValue("ADMIN_PASSWORD")
    || readEnvValue("DEFAULT_ADMIN_PASSWORD")
    || ""
  ).trim();
  return configuredPassword || null;
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

function isLegacyDefaultAdminPassword(user) {
  return String(user?.username || "").trim().toLowerCase() === "admin"
    && String(user?.plain_password || "") === "admin123";
}

function ensureUserSchema() {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const columnNames = new Set(columns.map((column) => column.name));
  const requiresRebuild = columnNames.has("plain_password") || !columnNames.has("must_change_password");
  if (!requiresRebuild) return;

  const existingUsers = db.prepare("SELECT * FROM users ORDER BY id").all();

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Admin',
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        pin_hash TEXT NOT NULL DEFAULT '',
        must_change_password INTEGER NOT NULL DEFAULT 0
      );
    `);
    const insertUser = db.prepare(`
      INSERT INTO users_new (id, username, full_name, role, email, phone, password_hash, pin_hash, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const user of existingUsers) {
      const mustChangePassword = columnNames.has("must_change_password")
        ? Number(user.must_change_password || 0)
        : (isLegacyDefaultAdminPassword(user) ? 1 : 0);
      const legacyPlainPassword = columnNames.has("plain_password") ? String(user.plain_password || "") : "";
      const passwordHash = legacyPlainPassword
        ? bcrypt.hashSync(legacyPlainPassword, 12)
        : String(user.password_hash || "");
      insertUser.run(
        user.id,
        user.username,
        user.full_name,
        user.role,
        user.email,
        user.phone,
        isBcryptHash(passwordHash) ? passwordHash : bcrypt.hashSync(crypto.randomUUID(), 12),
        String(user.pin_hash || ""),
        mustChangePassword ? 1 : 0
      );
    }

    db.exec(`
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function ensureInventorySchema() {
  const columns = db.prepare("PRAGMA table_info(inventory_items)").all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("supplier")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN supplier TEXT NOT NULL DEFAULT ''");
  }

  if (!columnNames.has("status")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN status TEXT NOT NULL DEFAULT 'In Stock'");
    const existingItems = db.prepare("SELECT id, stock_quantity, reorder_level FROM inventory_items").all();
    const updateStatus = db.prepare("UPDATE inventory_items SET status = ? WHERE id = ?");
    for (const item of existingItems) {
      updateStatus.run(deriveLegacyStatus(item.stock_quantity, item.reorder_level), item.id);
    }
  }

  ensureInventoryBarcodeSchema();
}

function normalizeBarcode(value) {
  return String(value || "").trim();
}

function legacyBarcodeForItem(item) {
  return `LEGACY-${item.id}`;
}

function seedBarcodeForItem(item, index) {
  const source = `${item.name || "ITEM"}-${index + 1}`.toUpperCase();
  const compact = source.replace(/[^A-Z0-9]/g, "").slice(0, 18) || `ITEM${index + 1}`;
  return `SEED-${compact}`;
}

function buildUniqueSeedBarcode(item, usedBarcodes, index) {
  const baseBarcode = seedBarcodeForItem(item, index);
  let barcode = baseBarcode;
  let suffix = 2;

  while (usedBarcodes.has(barcode)) {
    barcode = `${baseBarcode}-${suffix}`;
    suffix += 1;
  }

  usedBarcodes.add(barcode);
  return barcode;
}

function ensureInventoryBarcodeSchema() {
  const columns = db.prepare("PRAGMA table_info(inventory_items)").all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("barcode")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN barcode TEXT");
  }

  const items = db.prepare("SELECT id, barcode FROM inventory_items ORDER BY id").all();
  const usedBarcodes = new Set();
  const updateBarcode = db.prepare("UPDATE inventory_items SET barcode = ? WHERE id = ?");

  for (const item of items) {
    let barcode = normalizeBarcode(item.barcode);
    if (!barcode || usedBarcodes.has(barcode)) {
      barcode = legacyBarcodeForItem(item);
      while (usedBarcodes.has(barcode)) barcode = `${legacyBarcodeForItem(item)}-${usedBarcodes.size + 1}`;
      updateBarcode.run(barcode, item.id);
    }
    usedBarcodes.add(barcode);
  }

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_barcode_unique ON inventory_items(barcode)");

  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inventory_items'").get()?.sql || "";
  if (/barcode\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql)) return;

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE inventory_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        supplier TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'In Stock',
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        unit_price REAL NOT NULL DEFAULT 0,
        selling_price REAL NOT NULL DEFAULT 0,
        reorder_level INTEGER NOT NULL DEFAULT 10,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO inventory_items_new
        (id, barcode, name, category, supplier, status, stock_quantity, unit_price, selling_price, reorder_level, created_at)
      SELECT
        id, barcode, name, category, supplier, status, stock_quantity, unit_price, selling_price, reorder_level, created_at
      FROM inventory_items;
      DROP TABLE inventory_items;
      ALTER TABLE inventory_items_new RENAME TO inventory_items;
      CREATE UNIQUE INDEX idx_inventory_items_barcode_unique ON inventory_items(barcode);
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function ensureDigitalServiceRequestSchema() {
  const columns = db.prepare("PRAGMA table_info(digital_service_requests)").all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("failed_reason")) {
    db.exec("ALTER TABLE digital_service_requests ADD COLUMN failed_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!columnNames.has("failed_by_user_id")) {
    db.exec("ALTER TABLE digital_service_requests ADD COLUMN failed_by_user_id INTEGER");
  }
  if (!columnNames.has("failed_by_name")) {
    db.exec("ALTER TABLE digital_service_requests ADD COLUMN failed_by_name TEXT NOT NULL DEFAULT ''");
  }
  if (!columnNames.has("failed_at")) {
    db.exec("ALTER TABLE digital_service_requests ADD COLUMN failed_at TEXT");
  }
}

function ensureSalesSchema() {
  const columns = db.prepare("PRAGMA table_info(sales)").all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("employee_name")) {
    db.exec("ALTER TABLE sales ADD COLUMN employee_name TEXT NOT NULL DEFAULT 'System'");
  }
}

function ensureAuthSecuritySchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_login_security (
      username TEXT PRIMARY KEY,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      first_failed_at INTEGER,
      locked_until INTEGER
    );
    CREATE TABLE IF NOT EXISTS login_rate_limits (
      rate_key TEXT PRIMARY KEY,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      window_started_at INTEGER NOT NULL,
      blocked_until INTEGER
    );
  `);
}

function ensureReportingViews() {
  db.exec(`
    DROP VIEW IF EXISTS report_product_logs;
    CREATE VIEW report_product_logs AS
    SELECT
      s.id AS log_id,
      s.transaction_code AS transaction_code,
      s.sale_date AS sale_date,
      s.employee_name AS employee_name,
      s.created_at AS time_stamp,
      COALESCE(SUM(si.total), 0) AS total_amount
    FROM sales s
    INNER JOIN sale_items si ON si.sale_id = s.id
    GROUP BY s.id, s.transaction_code, s.sale_date, s.employee_name, s.created_at;

    DROP VIEW IF EXISTS report_eload_logs;
    CREATE VIEW report_eload_logs AS
    SELECT
      id AS request_id,
      request_code AS transaction_code,
      mobile_number AS number,
      network AS network,
      COALESCE(load_value, request_kind, '') AS item_name,
      amount AS amount,
      COALESCE(completed_by_name, requested_by_name, 'System') AS employee_name,
      date(datetime(COALESCE(completed_at, requested_at), '+8 hours')) AS sale_date,
      COALESCE(completed_at, requested_at) AS time_stamp,
      status,
      requested_by_name,
      requested_at,
      completed_by_name,
      completed_at,
      failed_reason
    FROM digital_service_requests
    WHERE service_type = 'eload';

    DROP VIEW IF EXISTS report_gcash_logs;
    CREATE VIEW report_gcash_logs AS
    SELECT
      id AS request_id,
      request_code AS transaction_code,
      mobile_number AS number,
      reference_no AS reference_no,
      request_kind AS request_kind,
      amount AS amount,
      COALESCE(completed_by_name, requested_by_name, 'System') AS employee_name,
      date(datetime(COALESCE(completed_at, requested_at), '+8 hours')) AS sale_date,
      COALESCE(completed_at, requested_at) AS time_stamp,
      status,
      requested_by_name,
      requested_at,
      completed_by_name,
      completed_at,
      failed_reason
    FROM digital_service_requests
    WHERE service_type = 'gcash';
  `);
}

function seedSuppliersFromInventory() {
  const existingCount = db.prepare("SELECT COUNT(*) AS count FROM suppliers").get().count;
  if (existingCount) return;

  const names = [...new Set(
    db.prepare("SELECT supplier FROM inventory_items WHERE TRIM(COALESCE(supplier, '')) <> '' ORDER BY supplier").all()
      .map((row) => String(row.supplier || "").trim())
      .filter(Boolean)
  )];

  if (!names.length) return;

  const insertSupplier = db.prepare("INSERT INTO suppliers (supplier_name, contact_no, address) VALUES (?, '', '')");
  const insertMany = withTransaction((supplierNames) => {
    supplierNames.forEach((name) => insertSupplier.run(name));
  });
  insertMany(names);
}

function seedCategoriesFromInventory() {
  const existingCount = db.prepare("SELECT COUNT(*) AS count FROM categories").get().count;
  if (existingCount) return;

  const names = [...new Set(
    db.prepare("SELECT category FROM inventory_items WHERE TRIM(COALESCE(category, '')) <> '' ORDER BY category").all()
      .map((row) => String(row.category || "").trim())
      .filter(Boolean)
  )];

  if (!names.length) return;

  const insertCategory = db.prepare("INSERT INTO categories (category_name) VALUES (?)");
  const insertMany = withTransaction((categoryNames) => {
    categoryNames.forEach((name) => insertCategory.run(name));
  });
  insertMany(names);
}

function seedEloadSettings() {
  const existingCount = db.prepare("SELECT COUNT(*) AS count FROM eload_networks").get().count;
  if (existingCount) return;

  const insertNetwork = db.prepare("INSERT INTO eload_networks (network_name) VALUES (?)");
  const insertPromo = db.prepare("INSERT INTO eload_promos (network_id, promo_name, selling_price) VALUES (?, ?, ?)");
  const insertDefaults = withTransaction(() => {
    Object.entries(defaultEloadNetworks).forEach(([networkName, promos]) => {
      const result = insertNetwork.run(networkName);
      const networkId = Number(result.lastInsertRowid);
      promos.forEach((promoName) => {
        insertPromo.run(networkId, promoName, parsePromoSellingPrice(promoName));
      });
    });
  });

  insertDefaults();
}

function buildSaleTransactionCode(saleId) {
  return `S${String(saleId).padStart(4, "0")}`;
}

function buildDigitalServiceRequestCode(serviceType, requestId) {
  const prefix = String(serviceType || "").toLowerCase() === "gcash" ? "GC" : "EL";
  return `${prefix}${String(requestId).padStart(4, "0")}`;
}

export function createSale({ saleDate, paymentMethod, items, digitalItems = [], skipStockValidation = false, employeeName = "System", number = "", referenceNo = "", requestedByUserId = null, completedByUserId = null }) {
  const insertSale = db.prepare(`INSERT INTO sales (transaction_code, sale_date, payment_method, employee_name, total_amount) VALUES (?, ?, ?, ?, ?)`);
  const updateSaleCode = db.prepare("UPDATE sales SET transaction_code = ? WHERE id = ?");
  const insertSaleItem = db.prepare(`INSERT INTO sale_items (sale_id, inventory_item_id, item_name, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertDigitalSaleItem = db.prepare(`
    INSERT INTO sale_digital_items (sale_id, service_type, request_code, mobile_number, network, load_type, load_value, notes, quantity, price, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPendingDigitalServiceRequest = db.prepare(`
    INSERT INTO digital_service_requests
    (request_code, service_type, status, mobile_number, amount, request_kind, network, load_type, load_value, reference_no, notes, requested_by_user_id, requested_by_name)
    VALUES (?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateDigitalServiceRequestCode = db.prepare("UPDATE digital_service_requests SET request_code = ? WHERE id = ?");

  const createTx = withTransaction((payload) => {
    const productSaleItems = Array.isArray(payload.items) ? payload.items : [];
    const digitalSaleItems = Array.isArray(payload.digitalItems) ? payload.digitalItems : [];
    const totalAmount = [...productSaleItems, ...digitalSaleItems].reduce((sum, item) => sum + Number(item.total || 0), 0);
    const activeEmployeeName = String(payload.employeeName || "System").trim() || "System";
    const saleResult = insertSale.run(`TMP-${crypto.randomUUID()}`, payload.saleDate, payload.paymentMethod, activeEmployeeName, totalAmount);
    const saleId = Number(saleResult.lastInsertRowid);
    const transactionCode = buildSaleTransactionCode(saleId);
    updateSaleCode.run(transactionCode, saleId);

    function createPendingDigitalRequest({
      serviceType,
      mobileNumber,
      amount,
      requestKind = "",
      network = "",
      loadType = "",
      loadValue = "",
      notes = ""
    }) {
      const requestResult = insertPendingDigitalServiceRequest.run(
        `TMP-${crypto.randomUUID()}`,
        serviceType,
        mobileNumber,
        amount,
        requestKind,
        network,
        loadType,
        loadValue,
        "",
        notes,
        payload.requestedByUserId ? Number(payload.requestedByUserId) : null,
        activeEmployeeName
      );
      const requestId = Number(requestResult.lastInsertRowid);
      const requestCode = buildDigitalServiceRequestCode(serviceType, requestId);
      updateDigitalServiceRequestCode.run(requestCode, requestId);
      return requestCode;
    }

    for (const item of productSaleItems) {
      const currentInventory = db.prepare("SELECT id, name, category, status FROM inventory_items WHERE id = ?").get(item.inventoryItemId);
      if (!currentInventory) throw new Error("One of the sale items does not exist.");
      if (normalizeItemStatus(currentInventory.status) === "Out of Stock") {
        throw new Error(`${currentInventory.name} is marked out of stock.`);
      }
      insertSaleItem.run(saleId, item.inventoryItemId, currentInventory.name, item.quantity, item.price, item.total);
    }

    for (const item of digitalSaleItems) {
      const mobileNumber = String(item.mobileNumber || payload.number || "").trim();
      const network = String(item.network || "").trim();
      const loadType = String(item.loadType || "").trim();
      const loadValue = String(item.loadValue || "").trim();
      const notes = String(item.notes || "").trim();
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const price = Number(item.price || 0);
      const total = Number(item.total || price * quantity);
      if (!mobileNumber) throw new Error("Digital service item is missing a mobile number.");
      if (!network) throw new Error("Digital service item is missing a network.");
      if (!loadValue) throw new Error("Digital service item is missing a load value.");
      if (total <= 0) throw new Error("Digital service amount must be greater than zero.");

      const requestCode = createPendingDigitalRequest({
        serviceType: "eload",
        mobileNumber,
        amount: total,
        network,
        loadType,
        loadValue,
        notes
      });
      insertDigitalSaleItem.run(
        saleId,
        "eload",
        requestCode,
        mobileNumber,
        network,
        loadType,
        loadValue,
        notes,
        quantity,
        price,
        total
      );
    }
  });

    createTx({ saleDate, paymentMethod, items, digitalItems, employeeName, number, referenceNo, requestedByUserId, completedByUserId });
  }

export function createDigitalServiceRequest(input) {
  const serviceType = String(input.serviceType || "").trim().toLowerCase() === "gcash" ? "gcash" : "eload";
  const amount = Number(input.amount || 0);
  if (amount <= 0) throw new Error("Amount must be greater than zero.");
  const insertRequest = db.prepare(`
    INSERT INTO digital_service_requests
    (request_code, service_type, status, mobile_number, amount, request_kind, network, load_type, load_value, reference_no, notes, requested_by_user_id, requested_by_name)
    VALUES (?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateRequestCode = db.prepare("UPDATE digital_service_requests SET request_code = ? WHERE id = ?");

  const requestResult = insertRequest.run(
    `TMP-${crypto.randomUUID()}`,
    serviceType,
    String(input.mobileNumber || "").trim(),
    amount,
    String(input.requestKind || "").trim(),
    String(input.network || "").trim(),
    String(input.loadType || "").trim(),
    String(input.loadValue || "").trim(),
    String(input.referenceNo || "").trim(),
    String(input.notes || "").trim(),
    input.requestedByUserId ? Number(input.requestedByUserId) : null,
    String(input.requestedByName || "System").trim()
  );
  const requestId = Number(requestResult.lastInsertRowid);
  const requestCode = buildDigitalServiceRequestCode(serviceType, requestId);
  updateRequestCode.run(requestCode, requestId);
}

export function completeDigitalServiceRequest(requestId, input) {
  const request = db.prepare("SELECT * FROM digital_service_requests WHERE id = ?").get(requestId);
  if (!request) throw new Error("Request not found.");
  if (request.status === "Completed") throw new Error("This request is already completed.");
  if (request.status === "Failed") throw new Error("This request was marked as failed.");

  const serviceType = String(request.service_type || "").toLowerCase();
  const referenceNo = String(input.referenceNo || request.reference_no || "").trim();
  if (serviceType === "gcash" && !referenceNo) {
    throw new Error("GCash completion requires a reference number.");
  }
  const completedByName = String(input.completedByName || "System").trim();

  const completeTx = withTransaction(() => {
    db.prepare(`
      UPDATE digital_service_requests
      SET status = 'Completed',
          reference_no = ?,
          completed_by_user_id = ?,
          completed_by_name = ?,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      referenceNo,
      input.completedByUserId ? Number(input.completedByUserId) : null,
      completedByName,
      requestId
    );
  });

  completeTx();
}

export function failDigitalServiceRequest(requestId, input) {
  const request = db.prepare("SELECT * FROM digital_service_requests WHERE id = ?").get(requestId);
  if (!request) throw new Error("Request not found.");
  if (request.status === "Completed") throw new Error("Completed requests cannot be marked as failed.");
  if (request.status === "Failed") throw new Error("This request is already marked as failed.");

  const failedReason = String(input.failedReason || "").trim();
  if (!failedReason) throw new Error("Failure reason is required.");

  db.prepare(`
    UPDATE digital_service_requests
    SET status = 'Failed',
        failed_reason = ?,
        failed_by_user_id = ?,
        failed_by_name = ?,
        failed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    failedReason,
    input.failedByUserId ? Number(input.failedByUserId) : null,
    String(input.failedByName || "System").trim(),
    requestId
  );
}

export function listDigitalServiceRequests() {
  return db.prepare(`
    SELECT *
    FROM digital_service_requests
    ORDER BY CASE WHEN status = 'Pending' THEN 0 ELSE 1 END, requested_at DESC, id DESC
  `).all().map((row) => ({
    ...row,
    amount: Number(row.amount || 0)
  }));
}

async function seedDefaults() {
  const insertDefaultUser = db.prepare(`
    INSERT INTO users (username, full_name, role, email, phone, password_hash, pin_hash, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findUserByUsername = db.prepare("SELECT id FROM users WHERE username = ?");
  const seededAdminPassword = getSeedAdminPassword();
  const defaultUsers = [
    {
      username: "admin",
      fullName: "Store Owner",
      role: "Admin",
      email: "owner@sarisaristore.com",
      phone: "+63 912 345 6789",
      password: seededAdminPassword || "admin123",
      mustChangePassword: seededAdminPassword ? 0 : 1
    },
    {
      username: "user",
      fullName: "User Staff",
      role: "User",
      email: "user@sarisaristore.com",
      phone: "+63 912 345 6790",
      password: "user123",
      mustChangePassword: 0
    }
  ];

  for (const user of defaultUsers) {
    if (!findUserByUsername.get(user.username)) {
      const passwordHash = await hashPassword(user.password);
      insertDefaultUser.run(
        user.username,
        user.fullName,
        user.role,
        user.email,
        user.phone,
        passwordHash,
        "",
        user.mustChangePassword
      );
    }
  }

  if (!db.prepare("SELECT COUNT(*) AS count FROM store_settings").get().count) {
    db.prepare(`
      INSERT INTO store_settings
      (id, store_name, store_address, contact_number, tax_id, operating_hours, low_stock_alert, out_of_stock_alert, daily_sales_alert, weekly_sales_alert)
      VALUES (1, ?, ?, ?, ?, ?, 1, 1, 1, 0)
    `).run("Sari-Sari Store", "123 Barangay Street, City, Province", "+63 912 345 6789", "", "Monday - Sunday, 6:00 AM - 10:00 PM");
  }

  if (!db.prepare("SELECT COUNT(*) AS count FROM inventory_items").get().count) {
    const insertItem = db.prepare(`INSERT INTO inventory_items (barcode, name, category, supplier, stock_quantity, unit_price, selling_price, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const usedBarcodes = new Set();
    const insertMany = withTransaction((items) => {
      for (const [index, item] of items.entries()) {
        insertItem.run(buildUniqueSeedBarcode(item, usedBarcodes, index), item.name, item.category, item.supplier || "", item.stockQuantity, item.unitPrice, item.sellingPrice, item.reorderLevel);
      }
    });
    insertMany(seedInventoryItems);
  }

  if (!db.prepare("SELECT COUNT(*) AS count FROM sales").get().count) {
    for (const sale of seedSales) {
      const items = sale.items.map((entry) => {
        const inventoryItem = db.prepare("SELECT id, name FROM inventory_items WHERE name = ?").get(entry.itemName);
        return { inventoryItemId: inventoryItem.id, itemName: inventoryItem.name, quantity: entry.quantity, price: entry.price, total: entry.quantity * entry.price };
      });
      createSale({ saleDate: sale.date, paymentMethod: sale.paymentMethod, items, skipStockValidation: true });
    }
  }
}

function seedMissingInventoryItems() {
  const existingNames = new Set(
    db.prepare("SELECT name FROM inventory_items").all()
      .map((row) => String(row.name || "").trim().toLowerCase())
  );
  const usedBarcodes = new Set(
    db.prepare("SELECT barcode FROM inventory_items WHERE TRIM(COALESCE(barcode, '')) <> ''").all()
      .map((row) => normalizeBarcode(row.barcode))
      .filter(Boolean)
  );
  const insertItem = db.prepare(`INSERT INTO inventory_items (barcode, name, category, supplier, stock_quantity, unit_price, selling_price, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const missingItems = seedInventoryItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !existingNames.has(String(item.name || "").trim().toLowerCase()));
  if (!missingItems.length) return;

  const insertMany = withTransaction((items) => {
    for (const { item, index } of items) {
      const barcode = buildUniqueSeedBarcode(item, usedBarcodes, index);
      insertItem.run(barcode, item.name, item.category, item.supplier || "", item.stockQuantity, item.unitPrice, item.sellingPrice, item.reorderLevel);
    }
  });
  insertMany(missingItems);
}

export async function initializeDatabase() {
  createSchema();
  ensureUserSchema();
  ensureInventorySchema();
  ensureSalesSchema();
  ensureDigitalServiceRequestSchema();
  ensureAuthSecuritySchema();
  ensureReportingViews();
  await seedDefaults();
  seedMissingInventoryItems();
  seedSuppliersFromInventory();
  seedCategoriesFromInventory();
  seedEloadSettings();
}

export function getUserByUsername(username) {
  return db.prepare("SELECT id, username, full_name, role, email, phone, must_change_password FROM users WHERE username = ?").get(username);
}

export function getUserById(id) {
  return db.prepare("SELECT id, username, full_name, role, email, phone, must_change_password FROM users WHERE id = ?").get(id);
}

export function getUserAuthByUsername(username) {
  return db.prepare("SELECT id, username, full_name, role, email, phone, password_hash, pin_hash, must_change_password FROM users WHERE username = ?").get(username);
}

export function getUserAuthById(id) {
  return db.prepare("SELECT id, username, full_name, role, email, phone, password_hash, pin_hash, must_change_password FROM users WHERE id = ?").get(id);
}

function normalizeLoginIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRateLimitKey(value) {
  return String(value || "").trim() || "unknown";
}

export function getLoginProtectionState(username, rateLimitKey, now = Date.now()) {
  const normalizedUsername = normalizeLoginIdentity(username);
  const normalizedRateLimitKey = normalizeRateLimitKey(rateLimitKey);
  const accountState = normalizedUsername
    ? db.prepare("SELECT failed_attempts, first_failed_at, locked_until FROM user_login_security WHERE username = ?").get(normalizedUsername)
    : null;
  const rateLimitState = db.prepare("SELECT attempt_count, window_started_at, blocked_until FROM login_rate_limits WHERE rate_key = ?").get(normalizedRateLimitKey);

  let accountLockedUntil = Number(accountState?.locked_until || 0);
  let rateLimitedUntil = Number(rateLimitState?.blocked_until || 0);

  if (accountLockedUntil && accountLockedUntil <= now) {
    db.prepare("DELETE FROM user_login_security WHERE username = ?").run(normalizedUsername);
    accountLockedUntil = 0;
  }

  if (rateLimitState) {
    const windowStartedAt = Number(rateLimitState.window_started_at || 0);
    if (rateLimitedUntil && rateLimitedUntil <= now) {
      db.prepare("DELETE FROM login_rate_limits WHERE rate_key = ?").run(normalizedRateLimitKey);
      rateLimitedUntil = 0;
    } else if (!rateLimitedUntil && (now - windowStartedAt) > LOGIN_RATE_LIMIT_WINDOW_MS) {
      db.prepare("DELETE FROM login_rate_limits WHERE rate_key = ?").run(normalizedRateLimitKey);
    }
  }

  return {
    accountLocked: Boolean(accountLockedUntil && accountLockedUntil > now),
    accountLockedUntil,
    rateLimited: Boolean(rateLimitedUntil && rateLimitedUntil > now),
    rateLimitedUntil
  };
}

export function recordFailedLoginAttempt(username, rateLimitKey, now = Date.now()) {
  const normalizedUsername = normalizeLoginIdentity(username);
  const normalizedRateLimitKey = normalizeRateLimitKey(rateLimitKey);

  const rateLimitState = db.prepare("SELECT attempt_count, window_started_at, blocked_until FROM login_rate_limits WHERE rate_key = ?").get(normalizedRateLimitKey);
  let attemptCount = 1;
  let windowStartedAt = now;
  let blockedUntil = 0;

  if (rateLimitState) {
    const existingWindowStartedAt = Number(rateLimitState.window_started_at || 0);
    if ((Number(rateLimitState.blocked_until || 0) > now)) {
      blockedUntil = Number(rateLimitState.blocked_until);
      attemptCount = Number(rateLimitState.attempt_count || 0);
      windowStartedAt = existingWindowStartedAt || now;
    } else if ((now - existingWindowStartedAt) <= LOGIN_RATE_LIMIT_WINDOW_MS) {
      attemptCount = Number(rateLimitState.attempt_count || 0) + 1;
      windowStartedAt = existingWindowStartedAt || now;
    }
  }

  if (!blockedUntil && attemptCount >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    blockedUntil = now + LOGIN_RATE_LIMIT_BLOCK_MS;
  }

  db.prepare(`
    INSERT INTO login_rate_limits (rate_key, attempt_count, window_started_at, blocked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(rate_key) DO UPDATE SET
      attempt_count = excluded.attempt_count,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until
  `).run(normalizedRateLimitKey, attemptCount, windowStartedAt, blockedUntil || null);

  let accountLockedUntil = 0;
  if (normalizedUsername) {
    const accountState = db.prepare("SELECT failed_attempts, first_failed_at, locked_until FROM user_login_security WHERE username = ?").get(normalizedUsername);
    let failedAttempts = 1;
    let firstFailedAt = now;

    if (accountState) {
      const existingFirstFailedAt = Number(accountState.first_failed_at || 0);
      const existingLockedUntil = Number(accountState.locked_until || 0);
      if (existingLockedUntil > now) {
        failedAttempts = Number(accountState.failed_attempts || 0);
        firstFailedAt = existingFirstFailedAt || now;
        accountLockedUntil = existingLockedUntil;
      } else if ((now - existingFirstFailedAt) <= LOGIN_ACCOUNT_WINDOW_MS) {
        failedAttempts = Number(accountState.failed_attempts || 0) + 1;
        firstFailedAt = existingFirstFailedAt || now;
      }
    }

    if (!accountLockedUntil && failedAttempts >= LOGIN_ACCOUNT_MAX_ATTEMPTS) {
      accountLockedUntil = now + LOGIN_ACCOUNT_LOCK_MS;
    }

    db.prepare(`
      INSERT INTO user_login_security (username, failed_attempts, first_failed_at, locked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        failed_attempts = excluded.failed_attempts,
        first_failed_at = excluded.first_failed_at,
        locked_until = excluded.locked_until
    `).run(normalizedUsername, failedAttempts, firstFailedAt, accountLockedUntil || null);
  }

  return {
    accountLocked: Boolean(accountLockedUntil && accountLockedUntil > now),
    accountLockedUntil,
    rateLimited: Boolean(blockedUntil && blockedUntil > now),
    rateLimitedUntil: blockedUntil
  };
}

export function clearFailedLoginAttempts(username, rateLimitKey) {
  const normalizedUsername = normalizeLoginIdentity(username);
  const normalizedRateLimitKey = normalizeRateLimitKey(rateLimitKey);
  if (normalizedUsername) {
    db.prepare("DELETE FROM user_login_security WHERE username = ?").run(normalizedUsername);
  }
  db.prepare("DELETE FROM login_rate_limits WHERE rate_key = ?").run(normalizedRateLimitKey);
}

export function listUsers() {
  return db.prepare("SELECT id, username, full_name, role, email, phone, must_change_password FROM users ORDER BY full_name, username").all();
}

export function listSuppliers() {
  return db.prepare(`
    SELECT supplier_id, supplier_name, contact_no, address
    FROM suppliers
    ORDER BY supplier_name COLLATE NOCASE, supplier_id
  `).all();
}

export function createSupplier(input) {
  const supplierName = String(input.supplierName || "").trim();
  const contactNo = String(input.contactNo || "").trim();
  const address = String(input.address || "").trim();
  if (!supplierName) throw new Error("Supplier name is required.");

  db.prepare(`
    INSERT INTO suppliers (supplier_name, contact_no, address)
    VALUES (?, ?, ?)
  `).run(supplierName, contactNo, address);
}

export function updateSupplier(supplierId, input) {
  const supplierName = String(input.supplierName || "").trim();
  const contactNo = String(input.contactNo || "").trim();
  const address = String(input.address || "").trim();
  if (!supplierName) throw new Error("Supplier name is required.");

  const supplier = db.prepare("SELECT supplier_name FROM suppliers WHERE supplier_id = ?").get(supplierId);
  if (!supplier) throw new Error("Supplier not found.");

  const updateTx = withTransaction(() => {
    db.prepare(`
      UPDATE suppliers
      SET supplier_name = ?, contact_no = ?, address = ?
      WHERE supplier_id = ?
    `).run(supplierName, contactNo, address, supplierId);

    if (supplier.supplier_name !== supplierName) {
      db.prepare("UPDATE inventory_items SET supplier = ? WHERE supplier = ?").run(supplierName, supplier.supplier_name);
    }
  });

  updateTx();
}

export function deleteSupplier(supplierId) {
  const supplier = db.prepare("SELECT supplier_name FROM suppliers WHERE supplier_id = ?").get(supplierId);
  if (!supplier) throw new Error("Supplier not found.");

  const deleteTx = withTransaction(() => {
    db.prepare("DELETE FROM suppliers WHERE supplier_id = ?").run(supplierId);
    db.prepare("UPDATE inventory_items SET supplier = '' WHERE supplier = ?").run(supplier.supplier_name);
  });

  deleteTx();
}

export function listCategories() {
  return db.prepare(`
    SELECT category_id, category_name
    FROM categories
    ORDER BY category_name COLLATE NOCASE, category_id
  `).all();
}

export function createCategory(input) {
  const categoryName = String(input.categoryName || "").trim();
  if (!categoryName) throw new Error("Category name is required.");
  if (db.prepare("SELECT 1 FROM categories WHERE lower(category_name) = lower(?)").get(categoryName)) {
    throw new Error("Category name already exists.");
  }

  db.prepare("INSERT INTO categories (category_name) VALUES (?)").run(categoryName);
}

export function updateCategory(categoryId, input) {
  const categoryName = String(input.categoryName || "").trim();
  if (!categoryName) throw new Error("Category name is required.");

  const category = db.prepare("SELECT category_name FROM categories WHERE category_id = ?").get(categoryId);
  if (!category) throw new Error("Category not found.");
  const duplicate = db.prepare("SELECT category_id FROM categories WHERE lower(category_name) = lower(?) AND category_id <> ?").get(categoryName, categoryId);
  if (duplicate) throw new Error("Category name already exists.");

  const updateTx = withTransaction(() => {
    db.prepare("UPDATE categories SET category_name = ? WHERE category_id = ?").run(categoryName, categoryId);

    if (category.category_name !== categoryName) {
      db.prepare("UPDATE inventory_items SET category = ? WHERE category = ?").run(categoryName, category.category_name);
    }
  });

  updateTx();
}

export function deleteCategory(categoryId) {
  const category = db.prepare("SELECT category_name FROM categories WHERE category_id = ?").get(categoryId);
  if (!category) throw new Error("Category not found.");

  const usageCount = db.prepare("SELECT COUNT(*) AS count FROM inventory_items WHERE category = ?").get(category.category_name).count;
  if (usageCount > 0) throw new Error("This category is used by inventory items and cannot be deleted.");

  db.prepare("DELETE FROM categories WHERE category_id = ?").run(categoryId);
}

export function listEloadNetworks() {
  const networks = db.prepare(`
    SELECT network_id, network_name
    FROM eload_networks
    ORDER BY network_name COLLATE NOCASE, network_id
  `).all();
  const promos = db.prepare(`
    SELECT promo_id, network_id, promo_name, selling_price
    FROM eload_promos
    ORDER BY promo_name COLLATE NOCASE, promo_id
  `).all();
  const promosByNetwork = new Map();
  promos.forEach((promo) => {
    const networkPromos = promosByNetwork.get(promo.network_id) || [];
    networkPromos.push({ ...promo, selling_price: Number(promo.selling_price || 0) });
    promosByNetwork.set(promo.network_id, networkPromos);
  });
  return networks.map((network) => ({
    ...network,
    promos: promosByNetwork.get(network.network_id) || []
  }));
}

export function getEloadPromoCatalog() {
  return listEloadNetworks().reduce((catalog, network) => {
    catalog[network.network_name] = network.promos.map((promo) => ({
      name: promo.promo_name,
      price: Number(promo.selling_price || 0)
    }));
    return catalog;
  }, {});
}

export function createEloadNetwork(input) {
  const networkName = String(input.networkName || "").trim().toUpperCase();
  if (!networkName) throw new Error("Network name is required.");
  if (db.prepare("SELECT 1 FROM eload_networks WHERE lower(network_name) = lower(?)").get(networkName)) {
    throw new Error("Network already exists.");
  }
  db.prepare("INSERT INTO eload_networks (network_name) VALUES (?)").run(networkName);
}

export function deleteEloadNetwork(networkId) {
  const network = db.prepare("SELECT network_id FROM eload_networks WHERE network_id = ?").get(networkId);
  if (!network) throw new Error("Network not found.");
  db.prepare("DELETE FROM eload_networks WHERE network_id = ?").run(networkId);
}

export function createEloadPromo(input) {
  const networkId = Number(input.networkId);
  const promoName = String(input.promoName || "").trim();
  const sellingPrice = Number(input.sellingPrice || 0);
  if (!db.prepare("SELECT 1 FROM eload_networks WHERE network_id = ?").get(networkId)) {
    throw new Error("Network not found.");
  }
  if (!promoName) throw new Error("Promo name is required.");
  if (sellingPrice <= 0) throw new Error("Selling price must be greater than zero.");
  db.prepare("INSERT INTO eload_promos (network_id, promo_name, selling_price) VALUES (?, ?, ?)")
    .run(networkId, promoName, sellingPrice);
}

export function updateEloadPromo(promoId, input) {
  const promoName = String(input.promoName || "").trim();
  const sellingPrice = Number(input.sellingPrice || 0);
  const promo = db.prepare("SELECT promo_id, network_id FROM eload_promos WHERE promo_id = ?").get(promoId);
  if (!promo) throw new Error("Promo not found.");
  if (!promoName) throw new Error("Promo name is required.");
  if (sellingPrice <= 0) throw new Error("Selling price must be greater than zero.");
  db.prepare("UPDATE eload_promos SET promo_name = ?, selling_price = ? WHERE promo_id = ?")
    .run(promoName, sellingPrice, promoId);
}

export function deleteEloadPromo(promoId) {
  const promo = db.prepare("SELECT promo_id FROM eload_promos WHERE promo_id = ?").get(promoId);
  if (!promo) throw new Error("Promo not found.");
  db.prepare("DELETE FROM eload_promos WHERE promo_id = ?").run(promoId);
}

export function getStoreSettings() {
  return db.prepare("SELECT * FROM store_settings WHERE id = 1").get();
}

export function updateStoreSettings(input) {
  db.prepare(`UPDATE store_settings SET store_name = ?, store_address = ?, contact_number = ?, tax_id = ?, operating_hours = ? WHERE id = 1`)
    .run(input.storeName, input.storeAddress, input.contactNumber, input.taxId, input.operatingHours);
}

export function updateUserProfile(userId, input) {
  db.prepare(`UPDATE users SET full_name = ?, email = ?, phone = ? WHERE id = ?`).run(input.fullName, input.email, input.phone, userId);
}

export async function createUserAccount(input) {
  const passwordHash = await hashPassword(input.password);
  db.prepare(`
    INSERT INTO users (username, full_name, role, email, phone, password_hash, pin_hash, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, '', 0)
  `).run(
    input.username,
    input.fullName,
    input.role,
    input.email,
    input.phone,
    passwordHash
  );
}

export async function updateUserAccount(userId, input) {
  db.prepare(`
    UPDATE users
    SET username = ?, full_name = ?, role = ?, email = ?, phone = ?
    WHERE id = ?
  `).run(input.username, input.fullName, input.role, input.email, input.phone, userId);

  if (input.password) {
    await updatePassword(userId, input.password);
  }
}

export function updateUserPin(userId, newPin) {
  // No-op as PINs are removed
}

export async function updatePassword(userId, newPassword) {
  const passwordHash = await hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(passwordHash, userId);
}

export function updateNotifications(input) {
  db.prepare(`UPDATE store_settings SET low_stock_alert = ?, out_of_stock_alert = ?, daily_sales_alert = ?, weekly_sales_alert = ? WHERE id = 1`)
    .run(input.lowStockAlert ? 1 : 0, input.outOfStockAlert ? 1 : 0, input.dailySalesAlert ? 1 : 0, input.weeklySalesAlert ? 1 : 0);
}

export function listInventory(search = "", status = "all") {
  const pattern = `%${search.trim()}%`;
  const items = db.prepare(`
    SELECT *
    FROM inventory_items
    WHERE name LIKE ? OR category LIKE ? OR supplier LIKE ? OR barcode LIKE ?
    ORDER BY name
  `).all(pattern, pattern, pattern, pattern).map((row) => ({
    ...row,
    status: normalizeItemStatus(row.status),
    profit: row.selling_price - row.unit_price
  }));

  if (status === "all") return items;
  if (status === "Low/Out of Stock") {
    return items.filter((item) => item.status === "Low Stock" || item.status === "Out of Stock");
  }
  return items.filter((item) => item.status === status);
}

export function getInventorySummary() {
  const items = listInventory("");
  return {
    total: items.length,
    inStock: items.filter((item) => item.status === "In Stock").length,
    lowStock: items.filter((item) => item.status === "Low Stock").length,
    outOfStock: items.filter((item) => item.status === "Out of Stock").length
  };
}

export function addInventoryItem(input) {
  const barcode = normalizeBarcode(input.barcode);
  if (!barcode) throw new Error("Barcode is required.");
  if (db.prepare("SELECT 1 FROM inventory_items WHERE barcode = ?").get(barcode)) {
    throw new Error("Barcode already exists.");
  }

  const category = String(input.category || "").trim();
  if (!category) throw new Error("Category is required.");
  if (!db.prepare("SELECT 1 FROM categories WHERE category_name = ?").get(category)) {
    throw new Error("Choose a valid category from Settings.");
  }

  db.prepare(`INSERT INTO inventory_items (barcode, name, category, supplier, status, stock_quantity, unit_price, selling_price, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(barcode, input.name, category, String(input.supplier || "").trim(), normalizeItemStatus(input.status), 0, Number(input.unitPrice), Number(input.sellingPrice), 0);
}

export function updateInventoryItem(id, input) {
  const barcode = normalizeBarcode(input.barcode);
  if (!barcode) throw new Error("Barcode is required.");
  if (db.prepare("SELECT 1 FROM inventory_items WHERE barcode = ? AND id != ?").get(barcode, id)) {
    throw new Error("Barcode already exists.");
  }

  const category = String(input.category || "").trim();
  if (!category) throw new Error("Category is required.");
  if (!db.prepare("SELECT 1 FROM categories WHERE category_name = ?").get(category)) {
    throw new Error("Choose a valid category from Settings.");
  }

  db.prepare(`UPDATE inventory_items SET barcode = ?, name = ?, category = ?, supplier = ?, status = ?, stock_quantity = ?, unit_price = ?, selling_price = ?, reorder_level = ? WHERE id = ?`)
    .run(barcode, input.name, category, String(input.supplier || "").trim(), normalizeItemStatus(input.status), 0, Number(input.unitPrice), Number(input.sellingPrice), 0, id);
}

export function updateInventoryItemStatus(id, status) {
  const item = db.prepare("SELECT id FROM inventory_items WHERE id = ?").get(id);
  if (!item) throw new Error("Item not found.");
  db.prepare("UPDATE inventory_items SET status = ? WHERE id = ?").run(normalizeItemStatus(status), id);
}

export function getInventoryItemByBarcode(barcode) {
  const normalizedBarcode = normalizeBarcode(barcode);
  if (!normalizedBarcode) return null;
  const item = db.prepare("SELECT * FROM inventory_items WHERE barcode = ?").get(normalizedBarcode);
  if (!item) return null;
  return {
    ...item,
    status: normalizeItemStatus(item.status),
    profit: item.selling_price - item.unit_price
  };
}

export function deleteInventoryItem(id) {
  const relatedSales = db.prepare("SELECT COUNT(*) AS count FROM sale_items WHERE inventory_item_id = ?").get(id).count;
  if (relatedSales > 0) throw new Error("This item already exists in sales history and cannot be deleted.");
  db.prepare("DELETE FROM inventory_items WHERE id = ?").run(id);
}

export function listSales(filter = "all") {
  let clause = "";
  const params = [];
  if (filter === "today") {
    clause = "WHERE sale_date = ?";
    params.push(toIsoDate(getTodayDate()));
  } else if (filter === "week") {
    clause = "WHERE sale_date >= ?";
    params.push(toIsoDate(shiftDate(getTodayDate(), -6)));
  } else if (filter === "month") {
    clause = "WHERE sale_date >= ?";
    params.push(toIsoDate(shiftDate(getTodayDate(), -29)));
  }

  const sales = db.prepare(`SELECT * FROM sales ${clause} ORDER BY sale_date DESC, id DESC`).all(...params);
  const itemStmt = db.prepare(`SELECT inventory_item_id, item_name, quantity, price, total FROM sale_items WHERE sale_id = ?`);
  const digitalItemStmt = db.prepare(`
    SELECT request_code, mobile_number, network, load_type, load_value, notes, quantity, price, total, service_type
    FROM sale_digital_items
    WHERE sale_id = ?
  `);
  return sales.map((sale) => ({
    ...sale,
    items: [
      ...itemStmt.all(sale.id).map((item) => ({ ...item, item_type: "inventory" })),
      ...digitalItemStmt.all(sale.id).map((item) => ({
        inventory_item_id: null,
        item_name: item.load_value,
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
        total: Number(item.total || 0),
        item_type: "eload",
        request_code: item.request_code,
        mobile_number: item.mobile_number,
        network: item.network,
        load_type: item.load_type,
        notes: item.notes,
        service_type: item.service_type
      }))
    ]
  }));
}

export function getSalesMetrics() {
  const rows = listSales("all");
  const now = startOfDay();
  const isoDate = toIsoDate(now);
  const todaySales = rows.filter((sale) => sale.sale_date === isoDate);
  const weekThreshold = shiftDate(now, -6);
  const monthThreshold = shiftDate(now, -29);
  const weeklySales = rows.filter((sale) => new Date(sale.sale_date) >= weekThreshold);
  const monthlySales = rows.filter((sale) => new Date(sale.sale_date) >= monthThreshold);

  return {
    todayTotal: todaySales.reduce((sum, sale) => sum + sale.total_amount, 0),
    todayTransactions: todaySales.length,
    todayItems: todaySales.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0),
    weeklyTotal: weeklySales.reduce((sum, sale) => sum + sale.total_amount, 0),
    monthlyTotal: monthlySales.reduce((sum, sale) => sum + sale.total_amount, 0)
  };
}

export function getQuickSaleRecommendations() {
  const availableItems = listInventory("").filter((item) => normalizeItemStatus(item.status) !== "Out of Stock");
  const itemsById = new Map(availableItems.map((item) => [item.id, item]));
  const allSales = listSales("all");
  const todayKey = toIsoDate(getTodayDate());
  const weekThreshold = shiftDate(getTodayDate(), -6);
  const todayScores = new Map();
  const weekScores = new Map();
  const smartScores = new Map();

  function addScore(map, itemId, amount) {
    map.set(itemId, (map.get(itemId) || 0) + amount);
  }

  allSales.forEach((sale) => {
    const saleDate = startOfDay(new Date(`${sale.sale_date}T00:00:00`));
    const daysAgo = Math.max(0, Math.round((startOfDay(getTodayDate()) - saleDate) / 86400000));
    const recencyWeight = Math.max(1, 14 - daysAgo);

    sale.items.forEach((item) => {
      if (!itemsById.has(item.inventory_item_id)) return;
      if (sale.sale_date === todayKey) addScore(todayScores, item.inventory_item_id, item.quantity);
      if (saleDate >= weekThreshold) addScore(weekScores, item.inventory_item_id, item.quantity);
      addScore(smartScores, item.inventory_item_id, (item.quantity * 3) + recencyWeight);
    });
  });

  function buildList(scores, limit) {
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([itemId, score]) => ({ ...itemsById.get(itemId), score }));
  }

  const fallback = availableItems.slice(0, 8);

  return {
    today: buildList(todayScores, 6),
    week: buildList(weekScores, 6),
    smart: buildList(smartScores, 8).length ? buildList(smartScores, 8) : fallback
  };
}

export function getDashboardData() {
  const inventory = listInventory("");
  const summary = getInventorySummary();
  const salesMetrics = getSalesMetrics();
  const bestSelling = getBestSellingData();
  const chartData = getDashboardChartData();
  const reportsData = getReportsData();
  const gcashMonthly = chartData.datasets.find((dataset) => dataset.label === "GCash")?.values.reduce((sum, value) => sum + Number(value || 0), 0) || 0;
  const loadMonthly = chartData.datasets.find((dataset) => dataset.label === "Load")?.values.reduce((sum, value) => sum + Number(value || 0), 0) || 0;
  const productsMonthly = chartData.datasets.find((dataset) => dataset.label === "Products")?.values.reduce((sum, value) => sum + Number(value || 0), 0) || 0;
  const combinedMonthly = gcashMonthly + loadMonthly + productsMonthly;
  const pendingEloadRequests = listDigitalServiceRequests()
    .filter((request) => request.status === "Pending" && request.service_type === "eload")
    .slice(0, 5);
  const pendingGcashRequests = listDigitalServiceRequests()
    .filter((request) => request.status === "Pending" && request.service_type === "gcash")
    .slice(0, 5);

  return {
    metrics: {
      totalProducts: summary.total,
      lowStockItems: summary.lowStock,
      outOfStockItems: summary.outOfStock,
      dailySales: salesMetrics.todayTotal,
      monthlySales: combinedMonthly,
      monthlyProducts: productsMonthly,
      monthlyLoad: loadMonthly,
      monthlyGcash: gcashMonthly,
      totalRevenue: reportsData.totalRevenue,
      averageDaily: reportsData.averageDaily,
      bestCategory: reportsData.bestCategory
    },
    lowStockItems: inventory.filter((item) => item.status !== "In Stock").slice(0, 4),
    pendingEloadRequests,
    pendingGcashRequests,
    bestSellingItem: bestSelling.items[0] || null,
    weeklySeries: reportsData.weeklySeries,
    monthlySeries: reportsData.monthlySeries,
    categoryBreakdown: reportsData.categoryBreakdown
  };
}

export function getDashboardChartData(range = "daily") {
  const today = getTodayDate();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const numberOfDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const labels = Array.from({ length: numberOfDays }, (_, index) => String(index + 1));
  const gcashValues = Array(numberOfDays).fill(0);
  const loadValues = Array(numberOfDays).fill(0);
  const productValues = Array(numberOfDays).fill(0);

  const productLogs = db.prepare(`
    SELECT sale_date AS saleDate, total_amount AS totalAmount
    FROM report_product_logs
    WHERE sale_date >= ? AND sale_date < ?
  `).all(toIsoDate(monthStart), toIsoDate(nextMonthStart));

  const completedDigitalRequests = db.prepare(`
    SELECT
      service_type AS serviceType,
      amount,
      completed_at AS completedAt,
      date(datetime(completed_at, '+8 hours')) AS completedDate
    FROM digital_service_requests
    WHERE status = 'Completed'
      AND completed_at IS NOT NULL
      AND date(datetime(completed_at, '+8 hours')) >= ?
      AND date(datetime(completed_at, '+8 hours')) < ?
  `).all(toIsoDate(monthStart), toIsoDate(nextMonthStart)).map((row) => ({
    ...row,
    amount: Number(row.amount || 0)
  }));

  for (const entry of productLogs) {
    const dayIndex = Number(String(entry.saleDate || "").slice(8, 10)) - 1;
    if (dayIndex >= 0 && dayIndex < numberOfDays) {
      productValues[dayIndex] += Number(entry.totalAmount || 0);
    }
  }

  for (const entry of completedDigitalRequests) {
    const dayIndex = Number(String(entry.completedDate || "").slice(8, 10)) - 1;
    if (dayIndex < 0 || dayIndex >= numberOfDays) continue;
    if (String(entry.serviceType || "").toLowerCase() === "gcash") {
      gcashValues[dayIndex] += Number(entry.amount || 0);
    } else if (String(entry.serviceType || "").toLowerCase() === "eload") {
      loadValues[dayIndex] += Number(entry.amount || 0);
    }
  }

  return {
    title: `Current Month Sales Trend (${today.toLocaleDateString("en-US", { month: "long", year: "numeric" })})`,
    labels,
    datasets: [
      { label: "GCash", values: gcashValues },
      { label: "Load", values: loadValues },
      { label: "Products", values: productValues }
    ]
  };
}

export function getReportsData() {
  const weeklySeries = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const current = shiftDate(getTodayDate(), -offset);
    const dateKey = toIsoDate(current);
    const total = db.prepare("SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE sale_date = ?").get(dateKey).total;
    weeklySeries.push({ label: current.toLocaleDateString("en-US", { weekday: "short" }), total });
  }

  const monthlySeries = db.prepare(`
    SELECT strftime('%Y-%m', sale_date) AS month_key, COALESCE(SUM(total_amount), 0) AS total
    FROM sales
    GROUP BY month_key
    ORDER BY month_key
  `).all().map((row) => ({
    label: new Date(`${row.month_key}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" }),
    total: row.total
  }));

  const categoryBreakdown = db.prepare(`
    SELECT ii.category AS category, COALESCE(SUM(si.total), 0) AS revenue
    FROM sale_items si
    INNER JOIN inventory_items ii ON ii.id = si.inventory_item_id
    GROUP BY ii.category
    ORDER BY revenue DESC
  `).all();

  const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales").get().total;
  const averageDaily = weeklySeries.reduce((sum, item) => sum + item.total, 0) / weeklySeries.length;
  return { totalRevenue, averageDaily, bestCategory: categoryBreakdown[0] || null, weeklySeries, monthlySeries, categoryBreakdown };
}

export function getBestSellingData() {
  const items = db.prepare(`
    SELECT ii.id, ii.name, SUM(si.quantity) AS quantity_sold, SUM(si.total) AS revenue
    FROM sale_items si
    INNER JOIN inventory_items ii ON ii.id = si.inventory_item_id
    GROUP BY ii.id, ii.name
    ORDER BY quantity_sold DESC, revenue DESC
  `).all().map((row, index) => ({ ...row, rank: index + 1, averagePrice: row.quantity_sold ? row.revenue / row.quantity_sold : 0 }));

  return {
    items,
    topItem: items[0] || null,
    totalUnitsSold: items.reduce((sum, item) => sum + item.quantity_sold, 0),
    totalRevenue: items.reduce((sum, item) => sum + item.revenue, 0)
  };
}

export function getLogsData(dateKey = toIsoDate(getTodayDate())) {
  const selectedDate = String(dateKey || toIsoDate(getTodayDate()));
  const productLogs = db.prepare(`
    SELECT
      log_id AS logId,
      transaction_code AS transactionCode,
      sale_date AS date,
      total_amount AS totalAmount,
      employee_name AS employee,
      time_stamp AS timeStamp
    FROM report_product_logs
    WHERE sale_date = ?
    ORDER BY time_stamp DESC, log_id DESC
  `).all(selectedDate).map((row) => {
    const items = db.prepare(`
      SELECT
        id AS logItemId,
        inventory_item_id AS productId,
        item_name AS itemName,
        quantity AS quantity,
        price AS sellingPrice
      FROM sale_items
      WHERE sale_id = ?
      ORDER BY id ASC
    `).all(row.logId).map((item) => ({
      ...item,
      quantity: Number(item.quantity || 0),
      sellingPrice: Number(item.sellingPrice || 0),
      amount: Number(item.quantity || 0) * Number(item.sellingPrice || 0)
    }));

    return {
      ...row,
      totalAmount: Number(row.totalAmount || 0),
      items
    };
  });

  const digitalRequestLogs = db.prepare(`
    SELECT
      logs.transaction_code AS requestCode,
      logs.service_type AS serviceType,
      logs.status,
      logs.number,
      logs.amount,
      logs.request_kind AS requestKind,
      logs.network,
      logs.load_type AS loadType,
      logs.load_value AS loadValue,
      logs.reference_no AS referenceNo,
      logs.requested_by_name AS requestedBy,
      logs.requested_at AS requestedAt,
      logs.completed_by_name AS completedBy,
      logs.completed_at AS completedAt
    FROM (
      SELECT
        'eload' AS service_type,
        transaction_code,
        number,
        amount,
        '' AS request_kind,
        network,
        '' AS load_type,
        item_name AS load_value,
        '' AS reference_no,
        requested_by_name,
        requested_at,
        completed_by_name,
        completed_at,
        status,
        time_stamp
      FROM report_eload_logs
      UNION ALL
      SELECT
        'gcash' AS service_type,
        transaction_code,
        number,
        amount,
        request_kind,
        '' AS network,
        '' AS load_type,
        '' AS load_value,
        reference_no,
        requested_by_name,
        requested_at,
        completed_by_name,
        completed_at,
        status,
        time_stamp
      FROM report_gcash_logs
    ) logs
    WHERE date(datetime(logs.requested_at, '+8 hours')) = ?
    ORDER BY logs.requested_at DESC, logs.transaction_code DESC
  `).all(selectedDate).map((row) => ({
    ...row,
    amount: Number(row.amount || 0)
  }));

  const eloadLogs = digitalRequestLogs
    .filter((row) => row.serviceType === "eload")
    .map((row) => ({
      ...row,
      paymentMethod: "Eload"
    }));

  const gcashLogs = digitalRequestLogs
    .filter((row) => row.serviceType === "gcash")
    .map((row) => ({
      ...row,
      totalAmount: Number(row.amount || 0)
    }));

  function buildStatusSummary(entries, amountKey) {
    const completed = entries.filter((entry) => String(entry.status || "").toLowerCase() === "completed");
    const failed = entries.filter((entry) => String(entry.status || "").toLowerCase() === "failed");
    return {
      totalCount: entries.length,
      totalAmount: entries.reduce((sum, entry) => sum + Number(entry[amountKey] || 0), 0),
      completedCount: completed.length,
      completedAmount: completed.reduce((sum, entry) => sum + Number(entry[amountKey] || 0), 0),
      failedCount: failed.length,
      failedAmount: failed.reduce((sum, entry) => sum + Number(entry[amountKey] || 0), 0)
    };
  }

  const eloadSummary = buildStatusSummary(eloadLogs, "amount");
  const gcashSummary = buildStatusSummary(gcashLogs, "totalAmount");

  return {
    selectedDate,
    summary: {
      productCount: productLogs.length,
      productTotal: productLogs.reduce((sum, entry) => sum + entry.totalAmount, 0),
      eloadCount: eloadSummary.totalCount,
      eloadTotal: eloadSummary.totalAmount,
      eloadCompletedCount: eloadSummary.completedCount,
      eloadCompletedTotal: eloadSummary.completedAmount,
      eloadFailedCount: eloadSummary.failedCount,
      eloadFailedTotal: eloadSummary.failedAmount,
      gcashCount: gcashSummary.totalCount,
      gcashTotal: gcashSummary.totalAmount,
      gcashCompletedCount: gcashSummary.completedCount,
      gcashCompletedTotal: gcashSummary.completedAmount,
      gcashFailedCount: gcashSummary.failedCount,
      gcashFailedTotal: gcashSummary.failedAmount
    },
    productLogs,
    eloadLogs,
    gcashLogs
  };
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

export function exportInventoryCsv() {
  const items = listInventory("");
  const headers = ["Name", "Category", "Unit Price", "Selling Price", "Profit", "Status"];
  const rows = items.map((item) => [item.name, item.category, item.unit_price, item.selling_price, item.profit, item.status]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function exportSalesCsv() {
  const sales = listSales("all");
  const headers = ["Transaction Code", "Date", "Payment Method", "Total Amount", "Items"];
  const rows = sales.map((sale) => [sale.transaction_code, sale.sale_date, sale.payment_method, sale.total_amount, sale.items.map((item) => `${item.item_name} x${item.quantity}`).join("; ")]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function getDatabasePath() {
  return dbPath;
}

export function resetAllData() {
  db.exec(`
    BEGIN;
    DELETE FROM sale_digital_items;
    DELETE FROM sale_items;
    DELETE FROM sales;
    DELETE FROM Selling_Log_Items;
    DELETE FROM Products_Log;
    DELETE FROM GCash_Log;
    DELETE FROM ELoad_Log;
    DELETE FROM digital_service_requests;
    DELETE FROM inventory_items;
    DELETE FROM sqlite_sequence
      WHERE name IN (
        'sale_digital_items',
        'sale_items',
        'sales',
        'Selling_Log_Items',
        'Products_Log',
        'GCash_Log',
        'ELoad_Log',
        'digital_service_requests',
        'inventory_items'
      );
    COMMIT;
  `);
}
