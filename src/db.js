import crypto from "node:crypto";
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

const dbPath = path.join(dataDir, "store.db");
export const db = new DatabaseSync(dbPath);

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
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, originalHash] = stored.split(":");
  const computedHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(originalHash, "hex"), Buffer.from(computedHash, "hex"));
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
      pin_hash TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
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
      weekly_sales_alert INTEGER NOT NULL DEFAULT 0,
      theme TEXT NOT NULL DEFAULT 'Light Mode',
      color_scheme TEXT NOT NULL DEFAULT 'Emerald'
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      supplier_id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT NOT NULL UNIQUE,
      contact_no TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function ensureUserSchema() {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("pin_hash")) {
    db.exec("ALTER TABLE users ADD COLUMN pin_hash TEXT NOT NULL DEFAULT ''");
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

function nextDigitalServiceRequestCode(serviceType) {
  const prefix = String(serviceType || "").toLowerCase() === "gcash" ? "GC" : "EL";
  const count = db.prepare("SELECT COUNT(*) AS count FROM digital_service_requests WHERE service_type = ?").get(serviceType).count + 1;
  return `${prefix}${String(count).padStart(4, "0")}`;
}

export function createSale({ saleDate, paymentMethod, items, digitalItems = [], skipStockValidation = false, employeeName = "System", number = "", referenceNo = "", requestedByUserId = null, completedByUserId = null }) {
  const insertSale = db.prepare(`INSERT INTO sales (transaction_code, sale_date, payment_method, total_amount) VALUES (?, ?, ?, ?)`);
  const insertSaleItem = db.prepare(`INSERT INTO sale_items (sale_id, inventory_item_id, item_name, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertDigitalSaleItem = db.prepare(`
    INSERT INTO sale_digital_items (sale_id, service_type, request_code, mobile_number, network, load_type, load_value, notes, quantity, price, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertProductsLog = db.prepare(`INSERT INTO Products_Log (Transaction_Code, Total_Amount, Emp_Mng, Sale_Date) VALUES (?, ?, ?, ?)`);
  const insertSellingLogItem = db.prepare(`INSERT INTO Selling_Log_Items (Log_ID, Product_ID, Item_Name, Quantity, Selling_Price) VALUES (?, ?, ?, ?, ?)`);
  const insertGcashLog = db.prepare(`INSERT INTO GCash_Log (Transaction_Code, Number, Reference_No, Cash_IN_OUT, Amount, Emp_Mng, Sale_Date) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertEloadLog = db.prepare(`INSERT INTO ELoad_Log (Transaction_Code, Number, Network, Item_Name, Amount, Emp_Mng, Sale_Date) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertPendingDigitalServiceRequest = db.prepare(`
    INSERT INTO digital_service_requests
    (request_code, service_type, status, mobile_number, amount, request_kind, network, load_type, load_value, reference_no, notes, requested_by_user_id, requested_by_name)
    VALUES (?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const createTx = withTransaction((payload) => {
    const productSaleItems = Array.isArray(payload.items) ? payload.items : [];
    const digitalSaleItems = Array.isArray(payload.digitalItems) ? payload.digitalItems : [];
    const totalAmount = [...productSaleItems, ...digitalSaleItems].reduce((sum, item) => sum + Number(item.total || 0), 0);
    const saleCount = db.prepare("SELECT COUNT(*) AS count FROM sales").get().count + 1;
    const transactionCode = `S${String(saleCount).padStart(4, "0")}`;
    const saleResult = insertSale.run(transactionCode, payload.saleDate, payload.paymentMethod, totalAmount);
    const saleId = saleResult.lastInsertRowid;
    const activeEmployeeName = String(payload.employeeName || "System");
      const productItems = [];
      const eloadItems = [];

      for (const item of productSaleItems) {
        const currentInventory = db.prepare("SELECT id, name, category, status FROM inventory_items WHERE id = ?").get(item.inventoryItemId);
        if (!currentInventory) throw new Error("One of the sale items does not exist.");
        if (normalizeItemStatus(currentInventory.status) === "Out of Stock") {
          throw new Error(`${currentInventory.name} is marked out of stock.`);
        }
        insertSaleItem.run(saleId, item.inventoryItemId, currentInventory.name, item.quantity, item.price, item.total);

        const category = String(currentInventory.category || "").toLowerCase();
      const normalizedItem = {
        inventoryItemId: currentInventory.id,
        itemName: currentInventory.name,
        category: currentInventory.category,
        quantity: item.quantity,
        price: item.price,
        total: item.total
      };

      if (category.includes("load")) {
        eloadItems.push(normalizedItem);
      } else {
        productItems.push(normalizedItem);
      }
    }

    if (productItems.length) {
      const productTotal = productItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
      const productLogResult = insertProductsLog.run(transactionCode, productTotal, activeEmployeeName, payload.saleDate);
      for (const item of productItems) {
        insertSellingLogItem.run(productLogResult.lastInsertRowid, item.inventoryItemId, item.itemName, item.quantity, item.price);
      }
    }

    if (String(payload.paymentMethod || "").toLowerCase() === "gcash") {
      insertGcashLog.run(transactionCode, String(payload.number || ""), String(payload.referenceNo || ""), "IN", totalAmount, activeEmployeeName, payload.saleDate);
    }

    for (const item of eloadItems) {
        insertEloadLog.run(
          transactionCode,
          String(payload.number || ""),
        String(item.category || item.itemName || ""),
        item.itemName,
        item.total,
        activeEmployeeName,
          payload.saleDate
        );
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

        const requestCode = nextDigitalServiceRequestCode("eload");
        insertPendingDigitalServiceRequest.run(
          requestCode,
          "eload",
          mobileNumber,
          total,
          "",
          network,
          loadType,
          loadValue,
          "",
          notes,
          payload.requestedByUserId ? Number(payload.requestedByUserId) : null,
          activeEmployeeName
        );
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
        insertEloadLog.run(transactionCode, mobileNumber, network, loadValue, total, activeEmployeeName, payload.saleDate);
      }
    });

    createTx({ saleDate, paymentMethod, items, digitalItems, employeeName, number, referenceNo, requestedByUserId, completedByUserId });
  }

export function createDigitalServiceRequest(input) {
  const serviceType = String(input.serviceType || "").trim().toLowerCase() === "gcash" ? "gcash" : "eload";
  const requestCode = nextDigitalServiceRequestCode(serviceType);
  const amount = Number(input.amount || 0);
  if (amount <= 0) throw new Error("Amount must be greater than zero.");

  db.prepare(`
    INSERT INTO digital_service_requests
    (request_code, service_type, status, mobile_number, amount, request_kind, network, load_type, load_value, reference_no, notes, requested_by_user_id, requested_by_name)
    VALUES (?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    requestCode,
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
}

export function completeDigitalServiceRequest(requestId, input) {
  const request = db.prepare("SELECT * FROM digital_service_requests WHERE id = ?").get(requestId);
  if (!request) throw new Error("Request not found.");
  if (request.status === "Completed") throw new Error("This request is already completed.");

  const serviceType = String(request.service_type || "").toLowerCase();
  const referenceNo = String(input.referenceNo || request.reference_no || "").trim();
  if (serviceType === "gcash" && !referenceNo) {
    throw new Error("GCash completion requires a reference number.");
  }

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
    String(input.completedByName || "System").trim(),
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

function backfillLogTablesFromSales() {
  const hasProductLogs = db.prepare("SELECT COUNT(*) AS count FROM Products_Log").get().count > 0;
  const hasGcashLogs = db.prepare("SELECT COUNT(*) AS count FROM GCash_Log").get().count > 0;
  const hasEloadLogs = db.prepare("SELECT COUNT(*) AS count FROM ELoad_Log").get().count > 0;
  if (hasProductLogs || hasGcashLogs || hasEloadLogs) return;

  const sales = listSales("all");
  const insertProductsLog = db.prepare(`INSERT INTO Products_Log (Transaction_Code, Total_Amount, Emp_Mng, Sale_Date) VALUES (?, ?, ?, ?)`);
  const insertSellingLogItem = db.prepare(`INSERT INTO Selling_Log_Items (Log_ID, Product_ID, Item_Name, Quantity, Selling_Price) VALUES (?, ?, ?, ?, ?)`);
  const insertGcashLog = db.prepare(`INSERT INTO GCash_Log (Transaction_Code, Number, Reference_No, Cash_IN_OUT, Amount, Emp_Mng, Sale_Date) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertEloadLog = db.prepare(`INSERT INTO ELoad_Log (Transaction_Code, Number, Network, Item_Name, Amount, Emp_Mng, Sale_Date) VALUES (?, ?, ?, ?, ?, ?, ?)`);

  withTransaction(() => {
    sales.forEach((sale) => {
      const productItems = [];
      const eloadItems = [];

      sale.items.forEach((item) => {
        const inventoryItem = db.prepare("SELECT id, category FROM inventory_items WHERE id = ?").get(item.inventory_item_id);
        const category = String(inventoryItem?.category || "").toLowerCase();
        const normalizedItem = {
          inventoryItemId: Number(item.inventory_item_id),
          itemName: item.item_name,
          category: inventoryItem?.category || "",
          quantity: Number(item.quantity || 0),
          price: Number(item.price || 0),
          total: Number(item.total || 0)
        };

        if (category.includes("load")) {
          eloadItems.push(normalizedItem);
        } else {
          productItems.push(normalizedItem);
        }
      });

      if (productItems.length) {
        const productTotal = productItems.reduce((sum, item) => sum + item.total, 0);
        const productLogResult = insertProductsLog.run(sale.transaction_code, productTotal, "System", sale.sale_date);
        productItems.forEach((item) => {
          insertSellingLogItem.run(productLogResult.lastInsertRowid, item.inventoryItemId, item.itemName, item.quantity, item.price);
        });
      }

      if (String(sale.payment_method || "").toLowerCase() === "gcash") {
        insertGcashLog.run(sale.transaction_code, "", "", "IN", Number(sale.total_amount || 0), "System", sale.sale_date);
      }

      eloadItems.forEach((item) => {
        insertEloadLog.run(sale.transaction_code, "", String(item.category || item.itemName || ""), item.itemName, item.total, "System", sale.sale_date);
      });
    });
  })();
}

function seedDefaults() {
  if (!db.prepare("SELECT COUNT(*) AS count FROM users").get().count) {
    db.prepare(`INSERT INTO users (username, full_name, role, email, phone, password_hash, pin_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("admin", "Store Owner", "Admin", "owner@sarisaristore.com", "+63 912 345 6789", hashPassword("admin123"), hashPin("1234"));
  }

  const usersMissingPin = db.prepare("SELECT id FROM users WHERE pin_hash = '' OR pin_hash IS NULL").all();
  const assignDefaultPin = db.prepare("UPDATE users SET pin_hash = ? WHERE id = ?");
  for (const user of usersMissingPin) {
    assignDefaultPin.run(hashPin("1234"), user.id);
  }

  if (!db.prepare("SELECT COUNT(*) AS count FROM store_settings").get().count) {
    db.prepare(`
      INSERT INTO store_settings
      (id, store_name, store_address, contact_number, tax_id, operating_hours, low_stock_alert, out_of_stock_alert, daily_sales_alert, weekly_sales_alert, theme, color_scheme)
      VALUES (1, ?, ?, ?, ?, ?, 1, 1, 1, 0, 'Light Mode', 'Emerald')
    `).run("Sari-Sari Store", "123 Barangay Street, City, Province", "+63 912 345 6789", "", "Monday - Sunday, 6:00 AM - 10:00 PM");
  }

  if (!db.prepare("SELECT COUNT(*) AS count FROM inventory_items").get().count) {
    const insertItem = db.prepare(`INSERT INTO inventory_items (name, category, supplier, stock_quantity, unit_price, selling_price, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertMany = withTransaction((items) => {
      for (const item of items) {
        insertItem.run(item.name, item.category, item.supplier || "", item.stockQuantity, item.unitPrice, item.sellingPrice, item.reorderLevel);
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

export function initializeDatabase() {
  createSchema();
  ensureUserSchema();
  ensureInventorySchema();
  seedDefaults();
  seedSuppliersFromInventory();
  backfillLogTablesFromSales();
}

export function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

export function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function listUsers() {
  return db.prepare("SELECT id, username, full_name, role, email, phone FROM users ORDER BY full_name, username").all();
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

export function createUserAccount(input) {
  db.prepare(`
    INSERT INTO users (username, full_name, role, email, phone, password_hash, pin_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.username,
    input.fullName,
    input.role,
    input.email,
    input.phone,
    hashPassword(input.password),
    input.role === "Admin" ? hashPin(input.pin) : ""
  );
}

export function updateUserAccount(userId, input) {
  db.prepare(`
    UPDATE users
    SET username = ?, full_name = ?, role = ?, email = ?, phone = ?
    WHERE id = ?
  `).run(input.username, input.fullName, input.role, input.email, input.phone, userId);

  if (input.password) {
    updatePassword(userId, input.password);
  }

  if (input.role === "User") {
    db.prepare("UPDATE users SET pin_hash = '' WHERE id = ?").run(userId);
  } else if (input.pin) {
    db.prepare("UPDATE users SET pin_hash = ? WHERE id = ?").run(hashPin(input.pin), userId);
  }
}

export function updateUserPin(userId, newPin) {
  db.prepare("UPDATE users SET pin_hash = ? WHERE id = ?").run(hashPin(newPin), userId);
}

export function updatePassword(userId, newPassword) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(newPassword), userId);
}

export function updateNotifications(input) {
  db.prepare(`UPDATE store_settings SET low_stock_alert = ?, out_of_stock_alert = ?, daily_sales_alert = ?, weekly_sales_alert = ? WHERE id = 1`)
    .run(input.lowStockAlert ? 1 : 0, input.outOfStockAlert ? 1 : 0, input.dailySalesAlert ? 1 : 0, input.weeklySalesAlert ? 1 : 0);
}

export function updateAppearance(input) {
  db.prepare(`UPDATE store_settings SET theme = ?, color_scheme = ? WHERE id = 1`).run(input.theme, input.colorScheme);
}

export function listInventory(search = "", status = "all") {
  const pattern = `%${search.trim()}%`;
  const items = db.prepare(`
    SELECT *
    FROM inventory_items
    WHERE name LIKE ? OR category LIKE ? OR supplier LIKE ?
    ORDER BY name
  `).all(pattern, pattern, pattern).map((row) => ({
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
  db.prepare(`INSERT INTO inventory_items (name, category, supplier, status, stock_quantity, unit_price, selling_price, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.name, input.category, String(input.supplier || "").trim(), normalizeItemStatus(input.status), 0, Number(input.unitPrice), Number(input.sellingPrice), 0);
}

export function updateInventoryItem(id, input) {
  db.prepare(`UPDATE inventory_items SET name = ?, category = ?, supplier = ?, status = ?, stock_quantity = ?, unit_price = ?, selling_price = ?, reorder_level = ? WHERE id = ?`)
    .run(input.name, input.category, String(input.supplier || "").trim(), normalizeItemStatus(input.status), 0, Number(input.unitPrice), Number(input.sellingPrice), 0, id);
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
  const pendingEloadRequests = listDigitalServiceRequests()
    .filter((request) => request.status === "Pending" && request.service_type === "eload")
    .slice(0, 5);
  const pendingGcashRequests = listDigitalServiceRequests()
    .filter((request) => request.status === "Pending" && request.service_type === "gcash")
    .slice(0, 5);
  const dailySeries = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const current = shiftDate(getTodayDate(), -offset);
    const dateKey = toIsoDate(current);
    const total = db.prepare("SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE sale_date = ?").get(dateKey).total;
    dailySeries.push({ label: current.toLocaleDateString("en-US", { weekday: "short" }), total });
  }

  return {
    metrics: {
      totalProducts: summary.total,
      lowStockItems: summary.lowStock,
      outOfStockItems: summary.outOfStock,
      dailySales: salesMetrics.todayTotal,
      weeklySales: salesMetrics.weeklyTotal,
      monthlySales: salesMetrics.monthlyTotal
    },
    lowStockItems: inventory.filter((item) => item.status !== "In Stock").slice(0, 4),
    pendingEloadRequests,
    pendingGcashRequests,
    bestSellingItem: bestSelling.items[0] || null,
    dailySeries
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

  const monthlySales = db.prepare(`
    SELECT id, sale_date, payment_method, total_amount
    FROM sales
    WHERE sale_date >= ? AND sale_date < ?
    ORDER BY sale_date
  `).all(toIsoDate(monthStart), toIsoDate(nextMonthStart));

  const saleItems = db.prepare(`
    SELECT
      sale_items.sale_id,
      sale_items.total,
      inventory_items.category
    FROM sale_items
    JOIN inventory_items ON inventory_items.id = sale_items.inventory_item_id
    JOIN sales ON sales.id = sale_items.sale_id
    WHERE sales.sale_date >= ? AND sales.sale_date < ?
  `).all(toIsoDate(monthStart), toIsoDate(nextMonthStart));
  const salesById = new Map(monthlySales.map((sale) => [sale.id, sale]));

  for (const sale of monthlySales) {
    const dayIndex = Number(sale.sale_date.slice(8, 10)) - 1;
    if (dayIndex >= 0 && dayIndex < numberOfDays && String(sale.payment_method || "").toLowerCase() === "gcash") {
      gcashValues[dayIndex] += Number(sale.total_amount || 0);
    }
  }

  for (const item of saleItems) {
    const sale = salesById.get(item.sale_id);
    if (!sale) continue;
    const dayIndex = Number(sale.sale_date.slice(8, 10)) - 1;
    if (dayIndex < 0 || dayIndex >= numberOfDays) continue;
    const category = String(item.category || "").toLowerCase();
    if (category.includes("load")) {
      loadValues[dayIndex] += Number(item.total || 0);
    } else {
      productValues[dayIndex] += Number(item.total || 0);
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
      Products_Log.Log_ID AS logId,
      Products_Log.Transaction_Code AS transactionCode,
      Products_Log.Sale_Date AS date,
      Products_Log.Total_Amount AS totalAmount,
      Products_Log.Emp_Mng AS employee,
      Products_Log.Time_Stamp AS timeStamp
    FROM Products_Log
    WHERE Products_Log.Sale_Date = ?
    ORDER BY Products_Log.Time_Stamp DESC, Products_Log.Log_ID DESC
  `).all(selectedDate).map((row) => {
    const items = db.prepare(`
      SELECT
        Log_Item_ID AS logItemId,
        Product_ID AS productId,
        Item_Name AS itemName,
        Quantity AS quantity,
        Selling_Price AS sellingPrice
      FROM Selling_Log_Items
      WHERE Log_ID = ?
      ORDER BY Log_Item_ID ASC
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
      request_code AS requestCode,
      service_type AS serviceType,
      status,
      mobile_number AS number,
      amount,
      request_kind AS requestKind,
      network,
      load_type AS loadType,
      load_value AS loadValue,
      reference_no AS referenceNo,
      requested_by_name AS requestedBy,
      requested_at AS requestedAt,
      completed_by_name AS completedBy,
      completed_at AS completedAt
    FROM digital_service_requests
    WHERE date(datetime(requested_at, '+8 hours')) = ?
    ORDER BY requested_at DESC, id DESC
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

  return {
    selectedDate,
    summary: {
      productCount: productLogs.length,
      productTotal: productLogs.reduce((sum, entry) => sum + entry.totalAmount, 0),
      eloadCount: eloadLogs.length,
      eloadTotal: eloadLogs.reduce((sum, entry) => sum + entry.amount, 0),
      gcashCount: gcashLogs.length,
      gcashTotal: gcashLogs.reduce((sum, entry) => sum + entry.totalAmount, 0)
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
    DELETE FROM sale_items;
    DELETE FROM sales;
    DELETE FROM inventory_items;
    DELETE FROM suppliers;
    DELETE FROM store_settings;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  seedDefaults();
  seedSuppliersFromInventory();
}
