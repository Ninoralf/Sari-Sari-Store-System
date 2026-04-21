import express from "express";
import session from "express-session";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addInventoryItem,
  completeDigitalServiceRequest,
  createUserAccount,
  createDigitalServiceRequest,
  createSale,
  deleteInventoryItem,
  exportInventoryCsv,
  exportSalesCsv,
  getBestSellingData,
  getDashboardData,
  getDashboardChartData,
  getDatabasePath,
  getLogsData,
  getReportsData,
  getSalesMetrics,
  getStoreSettings,
  listDigitalServiceRequests,
  getUserById,
  getUserByUsername,
  initializeDatabase,
  listUsers,
  listInventory,
  listSales,
  resetAllData,
  updateUserAccount,
  updateUserPin,
  updateAppearance,
  updateInventoryItem,
  updateNotifications,
  updatePassword,
  updateStoreSettings,
  updateUserProfile,
  verifyPin,
  verifyPassword,
  getInventorySummary
} from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const sessionMaxAgeMs = 30 * 60 * 1000;
const sessionCookieName = "store.sid";

initializeDatabase();

app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(session({
  name: sessionCookieName,
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
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

function setAuthSession(req, userId) {
  req.session.user = { id: userId };
  req.session.authToken = crypto.randomBytes(24).toString("hex");
  req.session.authExpiresAt = Date.now() + sessionMaxAgeMs;
  req.session.csrfToken = buildCsrfToken();
}

function clearAuthSession(req) {
  delete req.session.user;
  delete req.session.authToken;
  delete req.session.authExpiresAt;
  delete req.session.csrfToken;
}

function buildNotifications(storeSettings) {
  const notifications = [];
  const inventory = listInventory("");
  const metrics = getSalesMetrics();
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

  if (storeSettings.daily_sales_alert) {
    notifications.push({
      tone: "success",
      icon: "bi-cash-stack",
      title: "Today's sales",
      message: `${formatCurrency(metrics.todayTotal)} across ${metrics.todayTransactions} transaction${metrics.todayTransactions === 1 ? "" : "s"}.`
    });
  }

  if (storeSettings.weekly_sales_alert) {
    notifications.push({
      tone: "info",
      icon: "bi-calendar-week",
      title: "Weekly sales",
      message: `${formatCurrency(metrics.weeklyTotal)} recorded in the last 7 days.`
    });
  }

  return notifications;
}

function normalizeTheme(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dark" || normalized === "dark mode") return "Dark Mode";
  return "Light Mode";
}

function normalizeColorScheme(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "blue") return "Blue";
  if (normalized === "amber") return "Amber";
  return "Emerald";
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
    req.session.authExpiresAt = Date.now() + sessionMaxAgeMs;
  }

  res.locals.currentPath = req.path;
  res.locals.user = req.session.user ? getUserById(req.session.user.id) : null;
  res.locals.store = storeSettings;
  res.locals.notifications = req.session.user ? buildNotifications(storeSettings) : [];
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.quickSearch = req.path === "/inventory" ? String(req.query.search || "") : "";
  res.locals.quickSearchStatus = req.path === "/inventory" ? inventoryStatus : "all";
  res.locals.flash = req.session.flash || null;
  res.locals.appearance = {
    theme: normalizeTheme(storeSettings.theme),
    colorScheme: normalizeColorScheme(storeSettings.color_scheme)
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

function requireAuth(req, res, next) {
  if (!req.session.user || !req.session.authToken) {
    sendNoStore(res);
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

app.get("/", requireAuth, (req, res) => {
  const dashboard = getDashboardData();
  const chartData = getDashboardChartData();
  res.render("dashboard", {
    pageTitle: "Dashboard",
    todayLabel: todayLabel(),
    currentDateLabel: formatLongDate(isoDateToday()),
    metrics: dashboard.metrics,
    lowStockItems: dashboard.lowStockItems,
    bestSellingItem: dashboard.bestSellingItem,
    chartTitle: chartData.title,
    chartLabels: chartData.labels,
    chartDatasets: chartData.datasets,
    formatCurrency
  });
});

app.get("/api/dashboard/chart", requireApiAuth, (req, res) => {
  return res.json(getDashboardChartData());
});

app.get("/api/dashboard/overview", requireApiAuth, (req, res) => {
  const dashboard = getDashboardData();
  return res.json({
    metrics: dashboard.metrics,
    bestSellingItem: dashboard.bestSellingItem,
    lowStockItems: dashboard.lowStockItems
  });
});

app.get("/api/inventory", requireApiAuth, (req, res) => {
  const search = String(req.query.search || "");
  const status = normalizeInventoryStatus(req.query.status);
  const items = listInventory(search, status);
  return res.json({
    search,
    status,
    summary: getInventorySummary(),
    count: items.length,
    items
  });
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

app.get("/api/logs", requireApiAuth, requireAdminApi, (req, res) => {
  const date = String(req.query.date || isoDateToday());
  return res.json(getLogsData(date));
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
  return res.render("login", { pageTitle: "Login" });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    setFlash(req, "danger", "Invalid username or password.");
    return res.redirect("/login");
  }
  return req.session.regenerate(() => {
    setAuthSession(req, user.id);
    setFlash(req, "success", "Welcome back.");
    return req.session.save(() => res.redirect("/"));
  });
});

app.post("/logout", requireAuth, (req, res) => {
  clearAuthSession(req);
  return req.session.destroy(() => {
    res.clearCookie(sessionCookieName);
    sendNoStore(res);
    return res.redirect("/login");
  });
});

app.get("/inventory", requireAuth, (req, res) => {
  const search = req.query.search || "";
  const status = normalizeInventoryStatus(req.query.status);
  res.render("inventory", {
    pageTitle: "Inventory",
    todayLabel: todayLabel(),
    items: listInventory(search, status),
    summary: getInventorySummary(),
    search,
    status,
    categories: [...new Set(listInventory("").map((item) => item.category))].sort(),
    formatCurrency
  });
});

app.get("/eload", requireAuth, (req, res) => {
  res.render("eload", {
    pageTitle: "Eload",
    todayLabel: todayLabel(),
    requests: listDigitalServiceRequests(),
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
      const amount = loadType === "regular" ? Number(req.body.amount || 0) : parseCurrencyAmount(loadValue);

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

app.post("/inventory/add", requireAuth, requireAdmin, (req, res) => {
  try {
    addInventoryItem(req.body);
    setFlash(req, "success", "Inventory item added.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  res.redirect("/inventory");
});

app.post("/inventory/:id/update", requireAuth, requireAdmin, (req, res) => {
  try {
    updateInventoryItem(Number(req.params.id), req.body);
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
  const filter = req.query.filter || "all";
  res.render("sales", {
    pageTitle: "Sales",
    todayLabel: todayLabel(),
    sales: listSales(filter),
    filter,
    metrics: getSalesMetrics(),
    saleDateDefault: isoDateToday(),
    inventory: listInventory("").filter((item) => item.status !== "Out of Stock"),
    formatCurrency,
    formatLongDate
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

app.get("/reports", requireAuth, requireAdmin, (req, res) => {
  res.render("reports", { pageTitle: "Reports", todayLabel: todayLabel(), reports: getReportsData(), formatCurrency });
});

app.get("/logs", requireAuth, requireAdmin, (req, res) => {
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

app.get("/best-selling", requireAuth, requireAdmin, (req, res) => {
  res.redirect("/");
});

app.get("/settings", requireAuth, (req, res) => {
  const requestedTab = String(req.query.tab || "");
  const isAdmin = req.session.user.role === "Admin";
  const allowedTabs = isAdmin
    ? new Set(["store", "profile", "notifications", "appearance", "data"])
    : new Set(["profile", "appearance"]);
  const activeTab = allowedTabs.has(requestedTab) ? requestedTab : (isAdmin ? "store" : "profile");

  res.render("settings", {
    pageTitle: "Settings",
    todayLabel: todayLabel(),
    settings: getStoreSettings(),
    userProfile: getUserById(req.session.user.id),
    activeTab
  });
});

app.get("/inventory/print", requireAuth, (req, res) => {
  const search = String(req.query.search || "");
  const status = normalizeInventoryStatus(req.query.status);
  res.render("inventory-print", {
    pageTitle: "Print Inventory List",
    todayLabel: todayLabel(),
    items: listInventory(search, status),
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

app.post("/users/add", requireAuth, requireAdmin, (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  const username = String(req.body.username || "").trim();
  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim();
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  const pin = String(req.body.pin || "").trim();
  const securityPin = String(req.body.securityPin || "").trim();
  const role = normalizeRole(req.body.role);

  if (!username || !fullName || !email || !phone || !password) {
    setFlash(req, "danger", "All account fields except PIN are required for standard users.");
    return res.redirect("/users");
  }

  if (role === "Admin" && !isFourDigitPin(pin)) {
    setFlash(req, "danger", "New user PIN must be exactly 4 digits.");
    return res.redirect("/users");
  }

  if (!isFourDigitPin(securityPin) || !verifyPin(securityPin, currentUser.pin_hash)) {
    setFlash(req, "danger", "Security PIN is incorrect.");
    return res.redirect("/users");
  }

  try {
    createUserAccount({
      username,
      fullName,
      role,
      email,
      phone,
      password,
      pin
    });
    setFlash(req, "success", "User account created.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  return res.redirect("/users");
});

app.post("/users/:id/update", requireAuth, requireAdmin, (req, res) => {
  const currentUser = getUserById(req.session.user.id);
  const targetUserId = Number(req.params.id);
  const targetUser = getUserById(targetUserId);
  const username = String(req.body.username || "").trim();
  const fullName = String(req.body.fullName || "").trim();
  const email = String(req.body.email || "").trim();
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  const pin = String(req.body.pin || "").trim();
  const securityPin = String(req.body.securityPin || "").trim();

  if (!targetUser) {
    setFlash(req, "danger", "User account not found.");
    return res.redirect("/users");
  }

  if (!username || !fullName || !email || !phone) {
    setFlash(req, "danger", "Username, full name, email, and contact number are required.");
    return res.redirect("/users");
  }

  if (normalizeRole(req.body.role) === "Admin" && pin && !isFourDigitPin(pin)) {
    setFlash(req, "danger", "Updated PIN must be exactly 4 digits.");
    return res.redirect("/users");
  }

  if (normalizeRole(req.body.role) === "Admin" && !targetUser.pin_hash && !pin) {
    setFlash(req, "danger", "Admin accounts must have a 4-digit PIN.");
    return res.redirect("/users");
  }

  if (!isFourDigitPin(securityPin) || !verifyPin(securityPin, currentUser.pin_hash)) {
    setFlash(req, "danger", "Security PIN is incorrect.");
    return res.redirect("/users");
  }

  try {
    updateUserAccount(targetUserId, {
      username,
      fullName,
      role: normalizeRole(req.body.role),
      email,
      phone,
      password,
      pin
    });
    setFlash(req, "success", targetUserId === currentUser.id ? "Your account was updated." : "User account updated.");
  } catch (error) {
    setFlash(req, "danger", error.message);
  }
  return res.redirect("/users");
});

app.post("/settings/password", requireAuth, (req, res) => {
  const user = getUserById(req.session.user.id);
  if (!verifyPassword(req.body.currentPassword, user.password_hash)) {
    setFlash(req, "danger", "Current password is incorrect.");
    return res.redirect("/settings");
  }
  if (!req.body.newPassword || req.body.newPassword !== req.body.confirmPassword) {
    setFlash(req, "danger", "New passwords do not match.");
    return res.redirect("/settings");
  }
  updatePassword(req.session.user.id, req.body.newPassword);
  setFlash(req, "success", "Password changed successfully.");
  return res.redirect("/settings");
});

app.post("/settings/pin", requireAuth, (req, res) => {
  const user = getUserById(req.session.user.id);
  if (user.role !== "Admin") {
    setFlash(req, "danger", "Only admin accounts can use a security PIN.");
    return res.redirect("/settings");
  }
  if (!verifyPin(req.body.currentPin, user.pin_hash)) {
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
  updateAppearance({
    theme: normalizeTheme(req.body.theme),
    colorScheme: normalizeColorScheme(req.body.colorScheme)
  });
  setFlash(req, "success", "Appearance preferences saved.");
  res.redirect("/settings");
});

app.get("/settings/export/inventory.csv", requireAuth, requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="inventory.csv"');
  res.send(exportInventoryCsv());
});

app.get("/settings/export/sales.csv", requireAuth, requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="sales.csv"');
  res.send(exportSalesCsv());
});

app.get("/settings/backup", requireAuth, requireAdmin, (req, res) => {
  res.download(getDatabasePath(), "store-backup.db");
});

app.post("/settings/reset", requireAuth, requireAdmin, (req, res) => {
  resetAllData();
  setFlash(req, "warning", "All data reset to the seeded Figma sample content.");
  res.redirect("/settings");
});

app.use((req, res) => {
  res.status(404).render("not-found", { pageTitle: "Not Found", todayLabel: todayLabel() });
});

app.listen(port, () => {
  console.log(`Sari-Sari Store app running at http://localhost:${port}`);
});
