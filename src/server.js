import express from "express";
import session from "express-session";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  addInventoryItem,
  clearFailedLoginAttempts,
  clearTrustedDevicePinAttempts,
  completeDigitalServiceRequest,
  createTrustedDeviceRegistration,
  createCategory,
  createEloadNetwork,
  createEloadPromo,
  createUserAccount,
  createSupplier,
  createDigitalServiceRequest,
  createSale,
  deleteInventoryItem,
  deleteCategory,
  deleteEloadNetwork,
  deleteEloadPromo,
  failDigitalServiceRequest,
  exportInventoryCsv,
  exportSalesCsv,
  getBestSellingData,
  getDashboardData,
  getDashboardChartData,
  getDatabasePath,
  getInventoryItemByBarcode,
  getLogsData,
  getReportsData,
  getSalesMetrics,
  getStoreSettings,
  getEloadPromoCatalog,
  getLoginProtectionState,
  getTrustedDeviceAuthByTokenHash,
  getTrustedDevicePinProtectionState,
  getTrustedDeviceStatusForUser,
  getUserAuthById,
  getUserAuthByUsername,
  listDigitalServiceRequests,
  getUserById,
  initializeDatabase,
  importInventoryProducts,
  previewInventoryImport,
  listCategories,
  listEloadNetworks,
  listUsers,
  listInventory,
  listSuppliers,
  listSales,
  resetAllData,
  recordFailedLoginAttempt,
  recordFailedTrustedDevicePinAttempt,
  revokeTrustedDeviceForUser,
  revokeTrustedDevicesForUser,
  deleteSupplier,
  updateUserAccount,
  updateUserPin,
  updateCategory,
  updateEloadPromo,
  updateInventoryItem,
  updateInventoryItemStatus,
  updateNotifications,
  updatePassword,
  updateSupplier,
  updateStoreSettings,
  updateTrustedDevicePin,
  updateUserProfile,
  hashPin,
  touchTrustedDevice,
  verifyPin,
  verifyPassword,
  getInventorySummary
} from "./db.js";
import { SQLiteSessionStore } from "./sqlite-session-store.js";
import { formatProductName } from "./product-name.js";
import { parseInventoryCsv } from "./inventory-csv.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const sessionMaxAgeMs = 30 * 60 * 1000;
const sessionCookieName = "store.sid";
const trustedDeviceCookieName = "store.trusted_device";
const trustedDeviceMaxAgeMs = 90 * 24 * 60 * 60 * 1000;
const loginRateLimitMessage = "Too many failed sign-in attempts. Please wait a few minutes and try again.";

const versionData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "version.json"), "utf8"));
const systemVersion = versionData.version;
const envFilePath = path.join(__dirname, "..", ".env");

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

const sessionSecret = String(process.env.SESSION_SECRET || readEnvValue("SESSION_SECRET") || "").trim();
if (process.env.NODE_ENV === "production" && !sessionSecret) {
  throw new Error("SESSION_SECRET must be set in the environment or .env when NODE_ENV=production.");
}

await initializeDatabase();



app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
const sessionStore = new SQLiteSessionStore({ defaultTtlMs: sessionMaxAgeMs });
app.use(session({
  name: sessionCookieName,
  secret: sessionSecret || crypto.randomBytes(32).toString("hex"),
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionMaxAgeMs
  }
}));

function buildCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function setAuthSession(req, userId, mustChangePassword = false, trustedDeviceId = null) {
  req.session.user = { id: userId };
  req.session.authToken = crypto.randomBytes(24).toString("hex");
  req.session.authExpiresAt = Date.now() + sessionMaxAgeMs;
  req.session.csrfToken = buildCsrfToken();
  req.session.mustChangePassword = Boolean(mustChangePassword);
  if (trustedDeviceId) req.session.trustedDeviceId = Number(trustedDeviceId);
  else delete req.session.trustedDeviceId;
}

function clearAuthSession(req) {
  delete req.session.user;
  delete req.session.authToken;
  delete req.session.authExpiresAt;
  delete req.session.csrfToken;
  delete req.session.mustChangePassword;
  delete req.session.trustedDeviceId;
}

function trustedDeviceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: trustedDeviceMaxAgeMs
  };
}

function clearTrustedDeviceCookie(res) {
  res.clearCookie(trustedDeviceCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

function readRequestCookie(req, cookieName) {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== cookieName) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return "";
    }
  }
  return "";
}

function hashTrustedDeviceToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function getTrustedDeviceFromRequest(req) {
  const token = readRequestCookie(req, trustedDeviceCookieName);
  if (!token || token.length < 32) return null;
  return getTrustedDeviceAuthByTokenHash(hashTrustedDeviceToken(token));
}

function buildTrustedDeviceName(userAgent) {
  const value = String(userAgent || "").toLowerCase();
  const browser = value.includes("edg/") ? "Edge"
    : value.includes("firefox/") ? "Firefox"
      : value.includes("chrome/") || value.includes("crios/") ? "Chrome"
        : value.includes("safari/") ? "Safari"
          : "Browser";
  const platform = value.includes("android") ? "Android"
    : value.includes("iphone") || value.includes("ipad") ? "iOS"
      : value.includes("windows") ? "Windows"
        : value.includes("mac os") ? "macOS"
          : value.includes("linux") ? "Linux"
            : "this device";
  return `${browser} on ${platform}`;
}

function isTrustedDevicePin(value) {
  const pin = String(value || "").trim();
  return /^\d{4}$/.test(pin) && !/^(\d)\1{3}$/.test(pin);
}

function restoreTrustedDeviceSession(req, res, device) {
  return req.session.regenerate(() => {
    setAuthSession(req, device.user_id, device.must_change_password, device.id);
    touchTrustedDevice(device.id);
    return req.session.save(() => res.redirect("/"));
  });
}

function getLoginRateLimitKey(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown").trim().toLowerCase();
}

function buildNotifications(storeSettings, userRole = "Admin") {
  const notifications = [];
  const inventory = listInventory("");
  const metrics = userRole === "Admin" ? getSalesMetrics() : null;
  const pendingDigitalRequests = listDigitalServiceRequests().filter((request) => request.status === "Pending");
  const pendingEloadRequests = pendingDigitalRequests.filter((request) => request.service_type === "eload");
  const pendingGcashRequests = pendingDigitalRequests.filter((request) => request.service_type === "gcash");
  const lowStockItems = inventory.filter((item) => item.status === "Low Stock");
  const outOfStockItems = inventory.filter((item) => item.status === "Out of Stock");

  if (pendingDigitalRequests.length) {
    const requestParts = [];
    if (pendingEloadRequests.length) requestParts.push(`${pendingEloadRequests.length} eLoad`);
    if (pendingGcashRequests.length) requestParts.push(`${pendingGcashRequests.length} GCash`);
    notifications.push({
      tone: "primary",
      icon: "bi-bell",
      title: "Pending digital requests",
      message: `${requestParts.join(" and ")} request${pendingDigitalRequests.length === 1 ? "" : "s"} waiting to be completed.`,
      link: "/eload"
    });
  }

  if (storeSettings.low_stock_alert && lowStockItems.length) {
    notifications.push({
      tone: "warning",
      icon: "bi-exclamation-triangle",
      title: "Low stock items",
      message: `${lowStockItems.length} item${lowStockItems.length === 1 ? "" : "s"} need restocking soon.`,
      link: "/inventory?status=Low%20Stock"
    });
  }

  if (storeSettings.out_of_stock_alert && outOfStockItems.length) {
    notifications.push({
      tone: "danger",
      icon: "bi-x-octagon",
      title: "Out of stock",
      message: `${outOfStockItems.length} item${outOfStockItems.length === 1 ? "" : "s"} are unavailable right now.`,
      link: "/inventory?status=Out%20of%20Stock"
    });
  }

  if (userRole === "Admin" && storeSettings.daily_sales_alert) {
    notifications.push({
      tone: "success",
      icon: "bi-cash-stack",
      title: "Today's sales",
      message: `${formatCurrency(metrics.todayTotal)} across ${metrics.todayTransactions} transaction${metrics.todayTransactions === 1 ? "" : "s"}.`
    });
  }

  if (userRole === "Admin" && storeSettings.weekly_sales_alert) {
    notifications.push({
      tone: "info",
      icon: "bi-calendar-week",
      title: "Weekly sales",
      message: `${formatCurrency(metrics.weeklyTotal)} recorded in the last 7 days.`
    });
  }

  return notifications;
}

function sendNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});

app.use((req, res, next) => {
  const storeSettings = getStoreSettings();
  const inventoryStatus = normalizeInventoryStatus(req.query.status);
  if (!req.session.csrfToken) req.session.csrfToken = buildCsrfToken();
  const isAuthenticated = Boolean(req.session.user && req.session.authToken);

  if (isAuthenticated && (!req.session.authExpiresAt || req.session.authExpiresAt <= Date.now())) {
    clearAuthSession(req);
    return req.session.save(() => {
      res.clearCookie(sessionCookieName);
      return res.redirect("/login");
    });
  }

  if (isAuthenticated) {
    const currentUser = getUserById(req.session.user.id);
    if (!currentUser || !currentUser.is_active) {
      clearAuthSession(req);
      return req.session.save(() => {
        res.clearCookie(sessionCookieName);
        return res.redirect("/login");
      });
    }
  }

  if (isAuthenticated) {
    req.session.authExpiresAt = Date.now() + sessionMaxAgeMs;
  }

  res.locals.currentPath = req.path;
  res.locals.user = req.session.user ? getUserById(req.session.user.id) : null;
  res.locals.trustedDevice = res.locals.user ? getTrustedDeviceStatusForUser(res.locals.user.id) : null;
  res.locals.store = storeSettings;
  res.locals.notifications = req.session.user ? buildNotifications(storeSettings, res.locals.user?.role) : [];
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.quickSearch = req.path === "/inventory" ? String(req.query.search || "") : "";
  res.locals.quickSearchStatus = req.path === "/inventory" ? inventoryStatus : "all";
  res.locals.flash = req.session.flash || null;
  res.locals.trustedDeviceSetupPending = Boolean(req.session.trustedDeviceSetupPending);
  delete req.session.trustedDeviceSetupPending;
  res.locals.version = systemVersion;
  res.locals.appearance = {
    theme: "Light Mode",
    colorScheme: "Emerald",
    fontSize: "Normal",
    scale: 100
  };
  delete req.session.flash;
  if (req.session.user) sendNoStore(res);
  next();
});

app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.body?._csrf !== req.session.csrfToken) {
    setFlash(req, "danger", "Your session token is invalid or expired. Please try again.");
    return res.redirect(req.session.user ? "/settings" : "/login");
  }
  return next();
});

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

app.use((req, res, next) => {
  if (!req.session.user || !req.session.authToken) return next();
  const currentUser = getUserById(req.session.user.id);
  const mustChangePassword = Boolean(currentUser?.must_change_password);
  req.session.mustChangePassword = mustChangePassword;
  res.locals.forcePasswordChange = mustChangePassword;

  if (!mustChangePassword) return next();

  const allowSettingsView = req.method === "GET" && req.path === "/settings";
  const allowPasswordChange = req.method === "POST" && req.path === "/settings/password";
  const allowLogout = req.method === "POST" && req.path === "/logout";

  if (allowSettingsView || allowPasswordChange || allowLogout) return next();

  if (req.path.startsWith("/api/")) {
    return res.status(403).json({ error: "Password change required." });
  }

  setFlash(req, "warning", "Change the default admin password before continuing.");
  return res.redirect("/settings?tab=profile&forcePasswordChange=1");
});

function requireAuth(req, res, next) {
  if (!req.session.user || !req.session.authToken) {
    sendNoStore(res);
    res.clearCookie(sessionCookieName);
    return res.redirect("/login");
  }
  const currentUser = getUserById(req.session.user.id);
  if (!currentUser || !currentUser.is_active) {
    clearAuthSession(req);
    res.clearCookie(sessionCookieName);
    return res.redirect("/login");
  }
  return next();
}

function requireApiAuth(req, res, next) {
  if (!req.session.user || !req.session.authToken) {
    sendNoStore(res);
    return res.status(401).json({ error: "Authentication required." });
  }
  const currentUser = getUserById(req.session.user.id);
  if (!currentUser || !currentUser.is_active) {
    clearAuthSession(req);
    return res.status(401).json({ error: "Authentication required." });
  }
  return next();
}

function requireAdmin(req, res, next) {
  const currentUser = getUserById(req.session.user.id);
  if (!currentUser || currentUser.role !== "Admin") {
    setFlash(req, "danger", "You do not have access to that page.");
    return res.redirect("/");
  }
  return next();
}

function requireAdminApi(req, res, next) {
  const currentUser = getUserById(req.session.user.id);
  if (!currentUser || currentUser.role !== "Admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  return next();
}

function requireSalesAccess(req, res, next) {
  const currentUser = getUserById(req.session.user.id);
  if (!currentUser || (currentUser.role !== "Admin" && currentUser.role !== "User")) {
    setFlash(req, "danger", "You do not have access to that page.");
    return res.redirect("/");
  }
  return next();
}

function requireSalesApiAccess(req, res, next) {
  const currentUser = getUserById(req.session.user.id);
  if (!currentUser || (currentUser.role !== "Admin" && currentUser.role !== "User")) {
    return res.status(403).json({ error: "Sales access required." });
  }
  return next();
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-PH", { style: "currency", currency: "PHP" });
}

function formatLongDate(dateString) {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(`${String(value).replace(" ", "T")}Z`).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  });
}

function isoDateToday() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}

function todayLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function normalizeSalesFilter(value) {
  const filter = String(value || "all").trim().toLowerCase();
  if (["all", "today", "week", "month"].includes(filter)) return filter;
  return "all";
}

function normalizeInventoryStatus(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (normalized === "in stock" || normalized === "in-stock") return "In Stock";
  if (normalized === "low stock" || normalized === "low-stock") return "Low Stock";
  if (normalized === "out of stock" || normalized === "out-of-stock") return "Out of Stock";
  if (normalized === "low/out of stock" || normalized === "low-out-of-stock" || normalized === "low / out of stock") return "Low/Out of Stock";
  return "all";
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase() === "user" ? "User" : "Admin";
}

function sanitizeInventoryItems(items, isAdmin) {
  return items.map((item) => {
    const sanitizedItem = isAdmin
      ? item
      : (({ unit_price, profit, ...rest }) => rest)(item);
    const displayName = formatProductName(sanitizedItem.name);
    return { ...sanitizedItem, displayName: displayName.name, displayVariant: displayName.variant };
  });
}

function decorateProductName(item) {
  if (!item) return item;
  const displayName = formatProductName(item.name);
  return { ...item, displayName: displayName.name, displayVariant: displayName.variant };
}

function isFourDigitPin(value) {
  return /^\d{4}$/.test(String(value || "").trim());
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

function formatPhilippineMobile(value) {
  const digits = normalizePhoneDigits(value);
  if (digits.length !== 11 || !digits.startsWith("09")) return "";
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 11)}`;
}

function parseCurrencyAmount(value) {
  const match = String(value || "").match(/(\d+(?:\.\d+)?)/g);
  if (!match?.length) return 0;
  return Number(match[match.length - 1]);
}

function buildDigitalRequestsFingerprint(requests) {
  return requests.map((request) => [
    request.id,
    request.status,
    request.reference_no || "",
    request.completed_at || "",
    request.failed_at || "",
    request.failed_reason || ""
  ].join(":")).join("|");
}

app.get("/", requireAuth, (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  const isAdmin = currentUser?.role === "Admin";

  if (!isAdmin) {
    return res.render("user-dashboard", { pageTitle: "Quick POS Home", todayLabel: todayLabel() });
  }

  const dashboard = getDashboardData();
  const chartData = getDashboardChartData();
  return res.render("dashboard", {
    pageTitle: "Dashboard",
    todayLabel: todayLabel(),
    currentDateLabel: formatLongDate(isoDateToday()),
    metrics: dashboard.metrics,
    lowStockItems: sanitizeInventoryItems(dashboard.lowStockItems, isAdmin),
    pendingEloadRequests: dashboard.pendingEloadRequests,
    pendingGcashRequests: dashboard.pendingGcashRequests,
    bestSellingItem: decorateProductName(dashboard.bestSellingItem),
    chartTitle: chartData.title,
    chartLabels: chartData.labels,
    chartDatasets: chartData.datasets,
    weeklySeries: dashboard.weeklySeries,
    monthlySeries: dashboard.monthlySeries,
    categoryBreakdown: dashboard.categoryBreakdown,
    formatCurrency
  });
});

app.get("/api/dashboard/chart", requireApiAuth, requireAdminApi, (req, res) => {
  return res.json(getDashboardChartData());
});

app.get("/api/dashboard/overview", requireApiAuth, requireAdminApi, (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  const isAdmin = currentUser?.role === "Admin";
  const dashboard = getDashboardData();
  return res.json({
    metrics: dashboard.metrics,
    bestSellingItem: decorateProductName(dashboard.bestSellingItem),
    lowStockItems: sanitizeInventoryItems(dashboard.lowStockItems, isAdmin),
    pendingEloadRequests: dashboard.pendingEloadRequests,
    pendingGcashRequests: dashboard.pendingGcashRequests,
    weeklySeries: dashboard.weeklySeries,
    monthlySeries: dashboard.monthlySeries,
    categoryBreakdown: dashboard.categoryBreakdown
  });
});

app.get("/api/notifications", requireApiAuth, (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  return res.json({
    notifications: buildNotifications(getStoreSettings(), currentUser?.role)
  });
});

app.get("/api/inventory", requireApiAuth, (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  const isAdmin = currentUser?.role === "Admin";
  const search = String(req.query.search || "");
  const status = normalizeInventoryStatus(req.query.status);
  const items = listInventory(search, status);

  return res.json({
    search,
    status,
    summary: getInventorySummary(),
    count: items.length,
    items: sanitizeInventoryItems(items, isAdmin)
  });
});

app.get("/api/inventory/barcode/:barcode", requireApiAuth, (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  const isAdmin = currentUser?.role === "Admin";
  const item = getInventoryItemByBarcode(req.params.barcode);
  if (!item) return res.status(404).json({ error: "Product not found." });
  return res.json({ item: sanitizeInventoryItems([item], isAdmin)[0] });
});

app.get("/api/sales", requireApiAuth, requireSalesApiAccess, (req, res) => {
  const filter = normalizeSalesFilter(req.query.filter);
  const sales = listSales(filter);
  return res.json({
    filter,
    count: sales.length,
    sales
  });
});

app.get("/api/sales/metrics", requireApiAuth, requireSalesApiAccess, (req, res) => {
  return res.json(getSalesMetrics());
});

app.get("/api/logs", requireApiAuth, (req, res) => {
  const date = String(req.query.date || isoDateToday());
  return res.json(getLogsData(date));
});

app.get("/api/eload/requests", requireApiAuth, (req, res) => {
  const requests = listDigitalServiceRequests();
  return res.json({
    pendingCount: requests.filter((request) => request.status === "Pending").length,
    fingerprint: buildDigitalRequestsFingerprint(requests),
    requests
  });
});

app.post("/api/sales", requireApiAuth, requireSalesApiAccess, (req, res) => {
  try {
    const currentUser = getUserById(req.session.user.id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const digitalItems = Array.isArray(req.body.digitalItems) ? req.body.digitalItems : [];
    const normalizedItems = items.map((item) => ({
      inventoryItemId: Number(item.inventoryItemId),
      quantity: Number(item.quantity),
      price: Number(item.price),
      total: Number(item.quantity) * Number(item.price)
    })).filter((item) => item.inventoryItemId && item.quantity > 0);
    const normalizedDigitalItems = digitalItems.map((item) => ({
      mobileNumber: String(item.mobileNumber || "").trim(),
      network: String(item.network || "").trim(),
      loadType: String(item.loadType || "").trim(),
      loadValue: String(item.loadValue || "").trim(),
      notes: String(item.notes || "").trim(),
      quantity: Math.max(1, Number(item.quantity) || 1),
      price: Number(item.price),
      total: Math.max(1, Number(item.quantity) || 1) * Number(item.price)
    })).filter((item) => item.mobileNumber && item.network && item.loadValue && item.price > 0);

    if (!normalizedItems.length && !normalizedDigitalItems.length) {
      return res.status(400).json({ error: "Add at least one item to the sale." });
    }

    createSale({
      saleDate: req.body.saleDate || isoDateToday(),
      paymentMethod: req.body.paymentMethod,
      items: normalizedItems,
      digitalItems: normalizedDigitalItems,
      employeeName: currentUser?.full_name || currentUser?.username || "System",
      requestedByUserId: currentUser?.id,
      completedByUserId: currentUser?.id
    });

    return res.json({
      success: true,
      message: "Sale recorded successfully.",
      metrics: getSalesMetrics(),
      sales: listSales("all").slice(0, 20)
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  sendNoStore(res);
  const usePassword = String(req.query.password || "") === "1";
  const trustedDeviceToken = readRequestCookie(req, trustedDeviceCookieName);
  const trustedDevice = usePassword ? null : getTrustedDeviceFromRequest(req);

  if (!usePassword && trustedDeviceToken && !trustedDevice) clearTrustedDeviceCookie(res);
  if (trustedDevice && (!trustedDevice.is_active || trustedDevice.must_change_password)) {
    clearTrustedDeviceCookie(res);
  } else if (trustedDevice && !trustedDevice.pin_enabled) {
    return restoreTrustedDeviceSession(req, res, trustedDevice);
  }

  return res.render("login", {
    pageTitle: "Login",
    quickLogin: trustedDevice?.pin_enabled ? { username: trustedDevice.username, fullName: trustedDevice.full_name } : null,
    usePassword
  });
});

app.post("/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const rateLimitKey = getLoginRateLimitKey(req);
  const protectionState = getLoginProtectionState(username, rateLimitKey);

  if (protectionState.rateLimited || protectionState.accountLocked) {
    setFlash(req, "danger", loginRateLimitMessage);
    return res.redirect("/login");
  }

  const user = getUserAuthByUsername(username);
  if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
    const failedState = recordFailedLoginAttempt(username, rateLimitKey);
    setFlash(req, "danger", (failedState.rateLimited || failedState.accountLocked) ? loginRateLimitMessage : "Invalid username or password.");
    return res.redirect("/login");
  }
  clearFailedLoginAttempts(username, rateLimitKey);
  return req.session.regenerate(() => {
    setAuthSession(req, user.id, user.must_change_password);
    if (user.must_change_password) {
      setFlash(req, "warning", "Change the default admin password before continuing.");
      return req.session.save(() => res.redirect("/settings?tab=profile&forcePasswordChange=1"));
    }
    req.session.trustedDeviceSetupPending = true;
    setFlash(req, "success", "Welcome back.");
    return req.session.save(() => res.redirect("/"));
  });
});

app.post("/login/quick-unlock", async (req, res) => {
  const trustedDevice = getTrustedDeviceFromRequest(req);
  if (!trustedDevice || !trustedDevice.pin_enabled || !trustedDevice.is_active || trustedDevice.must_change_password) {
    clearTrustedDeviceCookie(res);
    setFlash(req, "danger", "Quick login is unavailable. Please sign in with your password.");
    return res.redirect("/login?password=1");
  }

  const protectionState = getTrustedDevicePinProtectionState(trustedDevice.id);
  if (protectionState.locked) {
    setFlash(req, "danger", "Too many unlock attempts. Please wait a few minutes and try again.");
    return res.redirect("/login");
  }

  if (!(await verifyPin(String(req.body.pin || ""), trustedDevice.pin_hash))) {
    const failedState = recordFailedTrustedDevicePinAttempt(trustedDevice.id);
    setFlash(req, "danger", failedState.locked ? "Too many unlock attempts. Please wait a few minutes and try again." : "Unable to unlock. Please try again.");
    return res.redirect("/login");
  }

  clearTrustedDevicePinAttempts(trustedDevice.id);
  return restoreTrustedDeviceSession(req, res, trustedDevice);
});

app.post("/logout", requireAuth, (req, res) => {
  clearAuthSession(req);
  return req.session.destroy(() => {
    res.clearCookie(sessionCookieName);
    sendNoStore(res);
    return res.redirect("/login");
  });
});

app.post("/trusted-device/register", requireAuth, async (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  if (!currentUser || !currentUser.is_active || currentUser.must_change_password) {
    setFlash(req, "danger", "Update your password before enabling quick login.");
    return res.redirect("/settings?tab=profile");
  }

  const pinEnabled = String(req.body.pinEnabled || "") === "1";
  const pin = String(req.body.pin || "").trim();
  const confirmPin = String(req.body.confirmPin || "").trim();
  if (pinEnabled && (!isTrustedDevicePin(pin) || pin !== confirmPin)) {
    setFlash(req, "danger", "Use a 4-digit PIN that is not made of repeated digits, and confirm it correctly.");
    return res.redirect("/");
  }

  const token = crypto.randomBytes(32).toString("base64url");
  try {
    const deviceId = createTrustedDeviceRegistration({
      userId: currentUser.id,
      tokenHash: hashTrustedDeviceToken(token),
      deviceName: buildTrustedDeviceName(req.get("user-agent")),
      pinEnabled,
      pinHash: pinEnabled ? await hashPin(pin) : "",
      expiresAt: Date.now() + trustedDeviceMaxAgeMs,
      replaceExisting: String(req.body.replaceExisting || "") === "1"
    });
    res.cookie(trustedDeviceCookieName, token, trustedDeviceCookieOptions());
    req.session.trustedDeviceId = deviceId;
    setFlash(req, "success", pinEnabled ? "This device is trusted and protected by a PIN." : "This device is trusted for quick login.");
  } catch (error) {
    setFlash(req, "danger", error.code === "TRUSTED_DEVICE_EXISTS" ? error.message : "Unable to register this device. Please try again.");
  }
  return res.redirect("/");
});

app.post("/trusted-device/remove", requireAuth, (req, res) => {
  const trustedDevice = getTrustedDeviceFromRequest(req);
  const registeredDevice = getTrustedDeviceStatusForUser(req.session.user.id);
  const deviceId = Number(req.session.trustedDeviceId || trustedDevice?.id || registeredDevice?.id || 0);
  if (deviceId) revokeTrustedDeviceForUser(req.session.user.id, deviceId);
  delete req.session.trustedDeviceId;
  clearTrustedDeviceCookie(res);
  setFlash(req, "success", "Trusted device removed. Future sign-ins will require your password.");
  return res.redirect("/settings?tab=profile");
});

app.get("/inventory", requireAuth, (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  const isAdmin = currentUser?.role === "Admin";
  const search = req.query.search || "";
  const status = normalizeInventoryStatus(req.query.status);
  const items = listInventory(search, status);
  res.render("inventory", {
    pageTitle: "Inventory",
    todayLabel: todayLabel(),
    items: sanitizeInventoryItems(items, isAdmin),
    summary: getInventorySummary(),
    search,
    status,
    categories: listCategories(),
    suppliers: listSuppliers(),
    formatCurrency
  });
});

app.get("/eload", requireAuth, (req, res) => {
  const requests = listDigitalServiceRequests();
  res.render("eload", {
    pageTitle: "Eload",
    todayLabel: todayLabel(),
    requests,
    eloadNetworks: listEloadNetworks(),
    eloadPromoCatalog: getEloadPromoCatalog(),
    requestsFingerprint: buildDigitalRequestsFingerprint(requests),
    formatCurrency,
    formatDateTime
  });
});

app.post("/eload/requests", requireAuth, (req, res) => {
  try {
    const currentUser = getUserById(req.session.user.id);
    const serviceType = String(req.body.serviceType || "").trim().toLowerCase() === "gcash" ? "gcash" : "eload";
    const mobileNumber = formatPhilippineMobile(req.body.mobileNumber);
    if (!mobileNumber) throw new Error("Enter a valid 11-digit mobile number starting with 09.");

    if (serviceType === "gcash") {
      const amount = Number(req.body.amount || 0);
      if (amount <= 0) throw new Error("Enter a valid GCash amount.");

      createDigitalServiceRequest({
        serviceType,
        mobileNumber,
        amount,
        requestKind: String(req.body.cashFlow || "").trim() || "Cash In",
        referenceNo: String(req.body.referenceNumber || "").trim(),
        notes: String(req.body.notes || "").trim(),
        requestedByUserId: currentUser?.id,
        requestedByName: currentUser?.full_name || currentUser?.username || "System"
      });
    } else {
      const loadType = String(req.body.loadType || "").trim().toLowerCase();
      const network = String(req.body.network || "").trim().toUpperCase();
      const loadValue = String(req.body.loadValue || "").trim();
      const amount = Number(req.body.amount || 0);

      if (!network) throw new Error("Choose a network for the eload request.");
      if (!loadValue) throw new Error("Choose a load option for the eload request.");
      if (amount <= 0) throw new Error("Enter a valid eload amount.");

      createDigitalServiceRequest({
        serviceType,
        mobileNumber,
        amount,
        network,
        loadType,
        loadValue,
        notes: String(req.body.notes || "").trim(),
        requestedByUserId: currentUser?.id,
        requestedByName: currentUser?.full_name || currentUser?.username || "System"
      });
    }

    setFlash(req, "success", "Digital service request created.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/eload");
});

app.post("/eload/requests/:id/complete", requireAuth, (req, res) => {
  try {
    const currentUser = getUserById(req.session.user.id);
    completeDigitalServiceRequest(Number(req.params.id), {
      referenceNo: String(req.body.referenceNumber || "").trim(),
      completedByUserId: currentUser?.id,
      completedByName: currentUser?.full_name || currentUser?.username || "System"
    });
    setFlash(req, "success", "Digital service request marked as completed.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/eload");
});

app.post("/eload/requests/:id/fail", requireAuth, (req, res) => {
  try {
    const currentUser = getUserById(req.session.user.id);
    failDigitalServiceRequest(Number(req.params.id), {
      failedReason: String(req.body.failedReason || "").trim(),
      failedByUserId: currentUser?.id,
      failedByName: currentUser?.full_name || currentUser?.username || "System"
    });
    setFlash(req, "warning", "Digital service request marked as failed.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/eload");
});

app.post("/inventory/add", requireAuth, requireAdmin, (req, res) => {
  try {
    addInventoryItem(req.body);
    setFlash(req, "success", "Inventory item added.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/inventory");
});

app.post("/inventory/:id/update", requireAuth, (req, res) => {
  try {
    const currentUser = getUserById(req.session.user.id);
    const isAdmin = currentUser?.role === "Admin";
    const itemId = Number(req.params.id);

    if (isAdmin) {
      updateInventoryItem(itemId, req.body);
    } else {
      updateInventoryItemStatus(itemId, req.body.status);
    }
    setFlash(req, "success", "Inventory item updated.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/inventory");
});

app.post("/inventory/:id/delete", requireAuth, requireAdmin, (req, res) => {
  try {
    deleteInventoryItem(Number(req.params.id));
    setFlash(req, "success", "Inventory item deleted.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/inventory");
});

app.get("/sales", requireAuth, requireSalesAccess, (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  const isAdmin = currentUser?.role === "Admin";
  const inventory = listInventory("").filter((item) => item.status !== "Out of Stock");
  res.render("sales", {
    pageTitle: "Sales",
    todayLabel: todayLabel(),
    saleDateDefault: isoDateToday(),
    inventory: sanitizeInventoryItems(inventory, isAdmin),
    categories: listCategories(),
    formatCurrency
  });
});

app.post("/sales/add", requireAuth, requireSalesAccess, (req, res) => {
  try {
    const currentUser = getUserById(req.session.user.id);
    const ids = Array.isArray(req.body.itemId) ? req.body.itemId : [req.body.itemId];
    const quantities = Array.isArray(req.body.quantity) ? req.body.quantity : [req.body.quantity];
    const prices = Array.isArray(req.body.price) ? req.body.price : [req.body.price];
    const items = ids.map((itemId, index) => ({
      inventoryItemId: Number(itemId),
      quantity: Number(quantities[index]),
      price: Number(prices[index]),
      total: Number(quantities[index]) * Number(prices[index])
    })).filter((item) => item.inventoryItemId && item.quantity > 0);

    if (!items.length) throw new Error("Add at least one item to the sale.");
    createSale({
      saleDate: req.body.saleDate || isoDateToday(),
      paymentMethod: req.body.paymentMethod,
      items,
      employeeName: currentUser?.full_name || currentUser?.username || "System"
    });
    setFlash(req, "success", "Sale recorded successfully.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/sales");
});

app.get("/logs", requireAuth, (req, res) => {
  const selectedDate = String(req.query.date || isoDateToday());
  res.render("logs", {
    pageTitle: "Logs",
    todayLabel: todayLabel(),
    selectedDate,
    logs: getLogsData(selectedDate),
    formatCurrency,
    formatDateTime
  });
});

app.get("/reports", requireAuth, (req, res) => {
  res.redirect("/");
});

app.get("/best-selling", requireAuth, requireAdmin, (req, res) => {
  res.redirect("/");
});

app.get("/settings", requireAuth, (req, res) => {
  const requestedTab = String(req.query.tab || "");
  const currentUser = getUserById(req.session.user.id);
  const isAdmin = currentUser?.role === "Admin";
  const allowedTabs = isAdmin
    ? new Set(["store", "profile", "notifications", "appearance", "data"])
    : new Set(["profile", "appearance"]);
  const activeTab = allowedTabs.has(requestedTab) ? requestedTab : (isAdmin ? "store" : "profile");
  const forcePasswordChange = Boolean(req.session.mustChangePassword || currentUser?.must_change_password);

  res.render("settings", {
    pageTitle: "Settings",
    todayLabel: todayLabel(),
    settings: getStoreSettings(),
    userProfile: currentUser,
    categories: isAdmin ? listCategories() : [],
    suppliers: isAdmin ? listSuppliers() : [],
    eloadNetworks: isAdmin ? listEloadNetworks() : [],
    productImportPreview: isAdmin ? req.session.productImportPreview || null : null,
    trustedDevice: getTrustedDeviceStatusForUser(currentUser.id),
    formatDateTime,
    activeTab: forcePasswordChange ? "profile" : activeTab,
    forcePasswordChange
  });
});

app.get("/inventory/print", requireAuth, (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  const isAdmin = currentUser?.role === "Admin";
  const search = String(req.query.search || "");
  const status = normalizeInventoryStatus(req.query.status);
  const items = listInventory(search, status);
  res.render("inventory-print", {
    pageTitle: "Print Inventory List",
    todayLabel: todayLabel(),
    items: sanitizeInventoryItems(items, isAdmin),
    search,
    status,
    formatCurrency
  });
});

app.get("/users", requireAuth, requireAdmin, (req, res) => {
  res.render("users", {
    pageTitle: "User Accounts",
    todayLabel: todayLabel(),
    users: listUsers()
  });
});

app.post("/settings/store", requireAuth, requireAdmin, (req, res) => {
  updateStoreSettings(req.body);
  setFlash(req, "success", "Store settings saved.");
  res.redirect("/settings");
});

app.post("/settings/profile", requireAuth, (req, res) => {
  updateUserProfile(req.session.user.id, req.body);
  setFlash(req, "success", "Profile updated.");
  res.redirect("/settings");
});

app.post("/users/add", requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim();
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  const role = normalizeRole(req.body.role);

  if (!username || !fullName || !email || !phone || !password) {
    setFlash(req, "danger", "All account fields are required.");
    return res.redirect("/users");
  }

  try {
    await createUserAccount({
      username,
      fullName,
      role,
      email,
      phone,
      password
    });
    setFlash(req, "success", "User account created.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  return res.redirect("/users");
});

app.post("/users/:id/update", requireAuth, requireAdmin, async (req, res) => {
  const targetUserId = Number(req.params.id);
  const targetUser = getUserById(targetUserId);
  const username = String(req.body.username || "").trim();
  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim();
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  const role = normalizeRole(req.body.role);

  if (!targetUser) {
    setFlash(req, "danger", "User account not found.");
    return res.redirect("/users");
  }

  if (!username || !fullName || !email || !phone) {
    setFlash(req, "danger", "Username, full name, email, and contact number are required.");
    return res.redirect("/users");
  }

  try {
    await updateUserAccount(targetUserId, {
      username,
      fullName,
      role,
      email,
      phone,
      password,
      isActive: req.body.isActive === undefined ? Boolean(targetUser.is_active) : Boolean(req.body.isActive)
    });
    setFlash(req, "success", "User account updated.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  return res.redirect("/users");
});

app.post("/users/:id/trusted-device/revoke", requireAuth, requireAdmin, (req, res) => {
  const targetUserId = Number(req.params.id);
  const targetUser = getUserById(targetUserId);
  if (!targetUser || !revokeTrustedDeviceForUser(targetUserId, Number(req.body.deviceId))) {
    setFlash(req, "danger", "Trusted device not found or already revoked.");
    return res.redirect("/users");
  }
  setFlash(req, "success", `Trusted device revoked for ${targetUser.full_name}.`);
  return res.redirect("/users");
});

app.post("/settings/password", requireAuth, async (req, res) => {
  const user = getUserAuthById(req.session.user.id);
  if (!(await verifyPassword(req.body.currentPassword, user.password_hash))) {
    setFlash(req, "danger", "Current password is incorrect.");
    return res.redirect("/settings");
  }
  if (!req.body.newPassword || req.body.newPassword !== req.body.confirmPassword) {
    setFlash(req, "danger", "New passwords do not match.");
    return res.redirect("/settings");
  }
  await updatePassword(req.session.user.id, req.body.newPassword);
  req.session.mustChangePassword = false;
  setFlash(req, "success", "Password changed successfully.");
  return res.redirect("/settings");
});

app.post("/trusted-device/pin", requireAuth, async (req, res) => {
  const trustedDevice = getTrustedDeviceStatusForUser(req.session.user.id);
  if (!trustedDevice) {
    setFlash(req, "danger", "Register this browser as a trusted device before managing its PIN.");
    return res.redirect("/settings?tab=profile");
  }

  const pinEnabled = String(req.body.pinEnabled || "") === "1";
  const pin = String(req.body.pin || "").trim();
  const confirmPin = String(req.body.confirmPin || "").trim();
  if (pinEnabled && (!isTrustedDevicePin(pin) || pin !== confirmPin)) {
    setFlash(req, "danger", "Use a 4-digit PIN that is not made of repeated digits, and confirm it correctly.");
    return res.redirect("/settings?tab=profile");
  }

  const updated = updateTrustedDevicePin(
    trustedDevice.id,
    req.session.user.id,
    pinEnabled,
    pinEnabled ? await hashPin(pin) : ""
  );
  setFlash(req, updated
    ? (pinEnabled ? "Quick-login PIN updated." : "Quick-login PIN disabled.")
    : "Unable to update the quick-login PIN.");
  return res.redirect("/settings?tab=profile");
});

app.post("/settings/pin", requireAuth, async (req, res) => {
  const user = getUserAuthById(req.session.user.id);
  if (user.role !== "Admin") {
    setFlash(req, "danger", "Only admin accounts can use a security PIN.");
    return res.redirect("/settings");
  }
  if (!(await verifyPin(req.body.currentPin, user.pin_hash))) {
    setFlash(req, "danger", "Current PIN is incorrect.");
    return res.redirect("/settings");
  }
  if (!isFourDigitPin(req.body.newPin) || req.body.newPin !== req.body.confirmPin) {
    setFlash(req, "danger", "New PINs must match and contain exactly 4 digits.");
    return res.redirect("/settings");
  }
  updateUserPin(user.id, req.body.newPin);
  setFlash(req, "success", "Security PIN changed successfully.");
  return res.redirect("/settings");
});

app.post("/settings/notifications", requireAuth, requireAdmin, (req, res) => {
  updateNotifications({
    lowStockAlert: Boolean(req.body.lowStockAlert),
    outOfStockAlert: Boolean(req.body.outOfStockAlert),
    dailySalesAlert: Boolean(req.body.dailySalesAlert),
    weeklySalesAlert: Boolean(req.body.weeklySalesAlert)
  });
  setFlash(req, "success", "Notification preferences saved.");
  res.redirect("/settings");
});

app.post("/settings/appearance", requireAuth, (req, res) => {
  setFlash(req, "success", "Appearance preferences are saved in this browser.");
  res.redirect("/settings?tab=appearance");
});

app.post("/settings/categories/add", requireAuth, requireAdmin, (req, res) => {
  try {
    createCategory(req.body);
    setFlash(req, "success", "Category added.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/inventory");
});

app.post("/settings/categories/:id/update", requireAuth, requireAdmin, (req, res) => {
  try {
    updateCategory(Number(req.params.id), req.body);
    setFlash(req, "success", "Category updated.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/inventory");
});

app.post("/settings/categories/:id/delete", requireAuth, requireAdmin, (req, res) => {
  try {
    deleteCategory(Number(req.params.id));
    setFlash(req, "success", "Category deleted.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/inventory");
});

app.post("/settings/suppliers/add", requireAuth, requireAdmin, (req, res) => {
  try {
    createSupplier(req.body);
    setFlash(req, "success", "Supplier added.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/inventory");
});

app.post("/settings/suppliers/:id/update", requireAuth, requireAdmin, (req, res) => {
  try {
    updateSupplier(Number(req.params.id), req.body);
    setFlash(req, "success", "Supplier updated.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/inventory");
});

app.post("/settings/suppliers/:id/delete", requireAuth, requireAdmin, (req, res) => {
  try {
    deleteSupplier(Number(req.params.id));
    setFlash(req, "success", "Supplier deleted.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/inventory");
});

app.post("/settings/eload/networks/add", requireAuth, requireAdmin, (req, res) => {
  try {
    createEloadNetwork(req.body);
    setFlash(req, "success", "eLoad network added.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/eload#view-set");
});

app.post("/settings/eload/networks/:id/delete", requireAuth, requireAdmin, (req, res) => {
  try {
    deleteEloadNetwork(Number(req.params.id));
    setFlash(req, "success", "eLoad network deleted.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/eload#view-set");
});

app.post("/settings/eload/promos/add", requireAuth, requireAdmin, (req, res) => {
  try {
    createEloadPromo(req.body);
    setFlash(req, "success", "eLoad promo added.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/eload#view-set");
});

app.post("/settings/eload/promos/:id/update", requireAuth, requireAdmin, (req, res) => {
  try {
    updateEloadPromo(Number(req.params.id), req.body);
    setFlash(req, "success", "eLoad promo updated.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/eload#view-set");
});

app.post("/settings/eload/promos/:id/delete", requireAuth, requireAdmin, (req, res) => {
  try {
    deleteEloadPromo(Number(req.params.id));
    setFlash(req, "success", "eLoad promo deleted.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/eload#view-set");
});

app.get("/settings/export/inventory.csv", requireAuth, requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="inventory.csv"');
  res.send(exportInventoryCsv());
});

app.post("/settings/import/products/preview", requireAuth, requireAdmin, (req, res) => {
  const parsed = parseInventoryCsv(req.body.csvContent);
  const preview = {
    duplicateHandling: req.body.duplicateHandling === "update" ? "update" : "skip",
    total: parsed.rows.length,
    newProducts: 0,
    existingProducts: 0,
    errors: parsed.errors,
    products: []
  };

  if (!preview.errors.length) {
    const importPreview = previewInventoryImport(parsed.rows);
    preview.total = importPreview.total;
    preview.newProducts = importPreview.newProducts;
    preview.existingProducts = importPreview.existingProducts;
    preview.errors = importPreview.errors;
    preview.products = importPreview.products;
  }

  req.session.productImportPreview = preview;
  res.redirect("/settings?tab=data");
});

app.post("/settings/import/products", requireAuth, requireAdmin, (req, res) => {
  const preview = req.session.productImportPreview;
  if (!preview || preview.errors?.length || !preview.products?.length) {
    setFlash(req, "danger", "Preview a valid product CSV before importing.");
    return res.redirect("/settings?tab=data");
  }

  try {
    const duplicateHandling = req.body.duplicateHandling === "update" ? "update" : "skip";
    const summary = importInventoryProducts(preview.products, duplicateHandling);
    delete req.session.productImportPreview;
    setFlash(req, "success", `Import complete: ${summary.created} new, ${summary.updated} updated, ${summary.skipped} skipped.`);
  } catch (error) {
    setFlash(req, "danger", `Import failed: ${error.message}`);
  }
  return res.redirect("/settings?tab=data");
});

app.get("/settings/export/sales.csv", requireAuth, requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="sales.csv"');
  res.send(exportSalesCsv());
});

app.get("/settings/backup", requireAuth, requireAdmin, (req, res) => {
  res.download(getDatabasePath(), "store-backup.db");
});

app.post("/settings/reset", requireAuth, requireAdmin, async (req, res) => {
  const currentUser = getUserAuthById(req.session.user.id);
  const currentPassword = String(req.body.currentPassword || "");

  if (!currentPassword) {
    setFlash(req, "danger", "Enter your current admin password to continue.");
    return res.redirect("/settings?tab=data");
  }

  if (!currentUser || !(await verifyPassword(currentPassword, currentUser.password_hash))) {
    setFlash(req, "danger", "Incorrect admin password. Data reset was canceled.");
    return res.redirect("/settings?tab=data");
  }

  resetAllData();
  setFlash(req, "success", "All application records were permanently deleted. Accounts, settings, and configuration were kept intact.");
  res.redirect("/settings?tab=data");
});

app.use((req, res) => {
  res.status(404).render("not-found", { pageTitle: "Not Found", todayLabel: todayLabel() });
});

app.listen(port, () => {
  console.log(`Sari-Sari Store app running at http://localhost:${port}`);
});
