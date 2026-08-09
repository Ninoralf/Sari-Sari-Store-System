import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const adminPassword = process.env.ADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomUUID();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sari-sari-smoke-"));
const smokeDbPath = path.join(tempDir, "store.db");
const smokePort = Number(process.env.SMOKE_PORT || crypto.randomInt(32000, 39000));
const baseUrl = `http://127.0.0.1:${smokePort}`;
const server = spawn(process.execPath, ["src/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ADMIN_PASSWORD: adminPassword,
    PORT: String(smokePort),
    SESSION_SECRET: "smoke-test-session-secret",
    STORE_DB_PATH: smokeDbPath
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let startupOutput = "";
let sessionCookie = "";

server.stdout.on("data", (chunk) => {
  startupOutput += chunk.toString();
});

server.stderr.on("data", (chunk) => {
  startupOutput += chunk.toString();
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited early.\n${startupOutput}`);
    }

    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });
      if (response.ok) return;
    } catch {
      await delay(500);
    }
  }

  throw new Error(`Server did not become ready.\n${startupOutput}`);
}

function extractCookie(response, name = "store.sid") {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const expression = new RegExp(`(?:^|[,\\s])${name.replace(".", "\\.")}=([^;]*)`);
  for (const header of setCookies) {
    const match = String(header).match(expression);
    if (match) return `${name}=${match[1]}`;
  }
  return "";
}

function updateSessionCookie(response) {
  const cookie = extractCookie(response);
  if (cookie) sessionCookie = cookie;
}

async function requestWithCookie(requestPath, cookie, options = {}) {
  const { headers: rawHeaders, ...fetchOptions } = options;
  const headers = new Headers(rawHeaders || {});
  if (cookie) headers.set("Cookie", cookie);
  return fetch(`${baseUrl}${requestPath}`, { redirect: "manual", ...fetchOptions, headers });
}

function getTrustedDeviceRow() {
  const database = new DatabaseSync(smokeDbPath);
  try {
    return database.prepare("SELECT * FROM user_devices ORDER BY id DESC LIMIT 1").get();
  } finally {
    database.close();
  }
}

function extractCsrfToken(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!match) {
    throw new Error("Login page did not include a CSRF token.");
  }
  return match[1];
}

async function request(path, options = {}) {
  const { headers: rawHeaders, ...fetchOptions } = options;
  const headers = new Headers(rawHeaders || {});
  if (sessionCookie && !headers.has("Cookie")) {
    headers.set("Cookie", sessionCookie);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...fetchOptions,
    headers
  });
  updateSessionCookie(response);
  return response;
}

async function main() {
  await waitForServer();

  const loginPage = await request("/login");
  if (!loginPage.ok) {
    throw new Error(`GET /login returned ${loginPage.status}.`);
  }
  const loginHtml = await loginPage.text();
  const csrfToken = extractCsrfToken(loginHtml);
  if (!sessionCookie) {
    throw new Error("GET /login did not include a session cookie.");
  }

  const loginResponse = await request("/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      _csrf: csrfToken,
      username: "admin",
      password: adminPassword
    }).toString()
  });

  if (loginResponse.status !== 302) {
    throw new Error(`POST /login returned ${loginResponse.status} instead of 302.`);
  }
  const loginLocation = loginResponse.headers.get("location");
  if (loginLocation !== "/") {
    throw new Error(`POST /login redirected to ${loginLocation || "(missing location)"} instead of /.`);
  }
  const authenticatedPaths = ["/", "/inventory", "/sales", "/eload", "/logs", "/settings", "/users"];

  for (const path of authenticatedPaths) {
    const response = await request(path);
    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}.`);
    }
  }

  const reportsResponse = await request("/reports");
  if (reportsResponse.status !== 302 || reportsResponse.headers.get("location") !== "/") {
    throw new Error(`/reports did not redirect to /. Received ${reportsResponse.status} -> ${reportsResponse.headers.get("location") || "(missing location)"}.`);
  }

  const bestSellingResponse = await request("/best-selling");
  if (bestSellingResponse.status !== 302 || bestSellingResponse.headers.get("location") !== "/") {
    throw new Error(`/best-selling did not redirect to /. Received ${bestSellingResponse.status} -> ${bestSellingResponse.headers.get("location") || "(missing location)"}.`);
  }

  const inventoryCsv = await request("/settings/export/inventory.csv");
  if (!inventoryCsv.ok) {
    throw new Error(`/settings/export/inventory.csv returned ${inventoryCsv.status}.`);
  }
  const inventoryCsvText = await inventoryCsv.text();
  const headerLine = inventoryCsvText.trim().split(/\r?\n/)[0];
  if (!headerLine.startsWith("Barcode,Name,Category,")) {
    throw new Error("Inventory CSV export is not import-ready.");
  }
  const settingsPage = await request("/settings?tab=data");
  const authenticatedCsrfToken = extractCsrfToken(await settingsPage.text());
  const importCategory = `Smoke Category ${crypto.randomUUID()}`;
  const categoryResponse = await request("/settings/categories/add", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: authenticatedCsrfToken, categoryName: importCategory }).toString()
  });
  if (categoryResponse.status !== 302 || categoryResponse.headers.get("location") !== "/inventory") {
    throw new Error("Smoke test category setup did not return to Inventory.");
  }
  const importBarcode = `SMOKE-IMPORT-${crypto.randomUUID()}`;
  const importCsv = [
    headerLine,
    `${importBarcode},Smoke Import Product,${importCategory},,0,1,2,0,In Stock`
  ].join("\n");
  const previewResponse = await request("/settings/import/products/preview", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      _csrf: authenticatedCsrfToken,
      csvContent: importCsv,
      duplicateHandling: "skip"
    }).toString()
  });
  if (previewResponse.status !== 302 || previewResponse.headers.get("location") !== "/settings?tab=data") {
    throw new Error(`Product import preview did not return to Settings Data: ${previewResponse.status} -> ${previewResponse.headers.get("location") || "(missing)"}.`);
  }
  const importResponse = await request("/settings/import/products", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: authenticatedCsrfToken, duplicateHandling: "skip" }).toString()
  });
  if (importResponse.status !== 302 || importResponse.headers.get("location") !== "/settings?tab=data") {
    throw new Error("Product import did not return to Settings Data.");
  }
  const importedProduct = await request(`/api/inventory/barcode/${encodeURIComponent(importBarcode)}`);
  if (!importedProduct.ok) {
    throw new Error("Imported product could not be found by barcode.");
  }

  const salesCsv = await request("/settings/export/sales.csv");
  if (!salesCsv.ok) {
    throw new Error(`/settings/export/sales.csv returned ${salesCsv.status}.`);
  }

  const trustedDeviceCsrf = extractCsrfToken(await (await request("/settings?tab=profile")).text());
  const trustedDeviceRegistration = await request("/trusted-device/register", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: trustedDeviceCsrf, pinEnabled: "0" }).toString()
  });
  if (trustedDeviceRegistration.status !== 302 || trustedDeviceRegistration.headers.get("location") !== "/") {
    throw new Error("Trusted-device registration did not return to the dashboard.");
  }
  const passwordlessTrustedCookie = extractCookie(trustedDeviceRegistration, "store.trusted_device");
  if (!passwordlessTrustedCookie) throw new Error("Trusted-device registration did not issue a credential cookie.");

  const passwordlessToken = decodeURIComponent(passwordlessTrustedCookie.split("=")[1]);
  const passwordlessDevice = getTrustedDeviceRow();
  const expectedTokenHash = crypto.createHash("sha256").update(passwordlessToken).digest("hex");
  if (!passwordlessDevice || passwordlessDevice.device_token_hash !== expectedTokenHash || passwordlessDevice.device_token_hash === passwordlessToken) {
    throw new Error("Trusted-device credential was not stored as a secure hash.");
  }
  if (passwordlessDevice.pin_hash) throw new Error("PIN-free trusted device unexpectedly stored a PIN.");

  const logoutCsrf = extractCsrfToken(await (await request("/settings?tab=profile")).text());
  const logoutResponse = await request("/logout", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: logoutCsrf }).toString()
  });
  if (logoutResponse.status !== 302 || logoutResponse.headers.get("location") !== "/login") {
    throw new Error("Logout did not return to the login page.");
  }
  sessionCookie = "";

  const automaticQuickLogin = await requestWithCookie("/login", passwordlessTrustedCookie);
  if (automaticQuickLogin.status !== 302 || automaticQuickLogin.headers.get("location") !== "/") {
    throw new Error("PIN-free trusted device did not restore a normal session.");
  }
  updateSessionCookie(automaticQuickLogin);
  if (!sessionCookie || !(await request("/")).ok) throw new Error("Quick login did not produce an authenticated session.");

  const removeTrustedDeviceCsrf = extractCsrfToken(await (await request("/settings?tab=profile")).text());
  const removeTrustedDevice = await request("/trusted-device/remove", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: removeTrustedDeviceCsrf }).toString()
  });
  if (removeTrustedDevice.status !== 302) throw new Error("Trusted-device removal failed.");

  const pinTrustedDeviceCsrf = extractCsrfToken(await (await request("/settings?tab=profile")).text());
  const pinTrustedDeviceRegistration = await request("/trusted-device/register", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: pinTrustedDeviceCsrf, pinEnabled: "1", pin: "2468", confirmPin: "2468" }).toString()
  });
  const pinTrustedCookie = extractCookie(pinTrustedDeviceRegistration, "store.trusted_device");
  const pinTrustedDevice = getTrustedDeviceRow();
  if (!pinTrustedCookie || !pinTrustedDevice?.pin_hash || pinTrustedDevice.pin_hash === "2468") {
    throw new Error("PIN-protected trusted device did not securely store its PIN.");
  }

  const pinLogoutCsrf = extractCsrfToken(await (await request("/settings?tab=profile")).text());
  await request("/logout", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: pinLogoutCsrf }).toString()
  });
  sessionCookie = "";

  const quickUnlockPage = await requestWithCookie("/login", pinTrustedCookie);
  const quickUnlockHtml = await quickUnlockPage.text();
  if (!quickUnlockPage.ok || !quickUnlockHtml.includes("Use password instead")) {
    throw new Error("PIN-protected trusted device did not show quick unlock with password fallback.");
  }
  const quickUnlockCsrf = extractCsrfToken(quickUnlockHtml);
  const quickUnlockSession = extractCookie(quickUnlockPage);
  const quickUnlockCookies = [quickUnlockSession, pinTrustedCookie].filter(Boolean).join("; ");

  const wrongPinResponse = await requestWithCookie("/login/quick-unlock", quickUnlockCookies, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: quickUnlockCsrf, pin: "0000" }).toString()
  });
  if (wrongPinResponse.status !== 302 || wrongPinResponse.headers.get("location") !== "/login") {
    throw new Error("Incorrect quick-login PIN was not rejected.");
  }

  const correctPinResponse = await requestWithCookie("/login/quick-unlock", quickUnlockCookies, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: quickUnlockCsrf, pin: "2468" }).toString()
  });
  if (correctPinResponse.status !== 302 || correctPinResponse.headers.get("location") !== "/") {
    throw new Error("Correct quick-login PIN did not restore a normal session.");
  }
  updateSessionCookie(correctPinResponse);

  const passwordFallbackPage = await requestWithCookie("/login?password=1", pinTrustedCookie);
  const passwordFallbackHtml = await passwordFallbackPage.text();
  if (!passwordFallbackPage.ok || !passwordFallbackHtml.includes('name="password"')) {
    throw new Error("Password fallback was not available for trusted-device login.");
  }

  const replaceCsrf = extractCsrfToken(await (await request("/settings?tab=profile")).text());
  const replacementRegistration = await request("/trusted-device/register", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: replaceCsrf, pinEnabled: "0", replaceExisting: "1" }).toString()
  });
  const replacementTrustedCookie = extractCookie(replacementRegistration, "store.trusted_device");
  if (!replacementTrustedCookie) throw new Error("Trusted-device replacement did not issue a new credential.");
  const replacedCredentialLogin = await requestWithCookie("/login", pinTrustedCookie);
  if (replacedCredentialLogin.status !== 200) {
    throw new Error("Replaced trusted-device credential was still accepted.");
  }

  const activeDevice = getTrustedDeviceRow();
  const revokeCsrf = extractCsrfToken(await (await request("/settings?tab=profile")).text());
  const revokeResponse = await request(`/users/1/trusted-device/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: revokeCsrf, deviceId: String(activeDevice.id) }).toString()
  });
  if (revokeResponse.status !== 302) throw new Error("Admin trusted-device revocation failed.");
  const revokedCredentialLogin = await requestWithCookie("/login", replacementTrustedCookie);
  if (revokedCredentialLogin.status !== 200) {
    throw new Error("Revoked trusted-device credential was still accepted.");
  }

  const createUserCsrf = extractCsrfToken(await (await request("/settings?tab=profile")).text());
  const quickLoginUsername = `quick-user-${crypto.randomUUID().slice(0, 8)}`;
  const quickLoginPassword = "QuickLoginPass123!";
  const createUserResponse = await request("/users/add", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      _csrf: createUserCsrf,
      username: quickLoginUsername,
      fullName: "Quick Login User",
      role: "User",
      email: `${quickLoginUsername}@example.test`,
      phone: "09123456789",
      password: quickLoginPassword
    }).toString()
  });
  if (createUserResponse.status !== 302) throw new Error("Smoke-test user could not be created.");

  const userLoginPage = await requestWithCookie("/login?password=1", "");
  const userLoginCsrf = extractCsrfToken(await userLoginPage.text());
  const userGuestSession = extractCookie(userLoginPage);
  const userLoginResponse = await requestWithCookie("/login", userGuestSession, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: userLoginCsrf, username: quickLoginUsername, password: quickLoginPassword }).toString()
  });
  const userSession = extractCookie(userLoginResponse);
  if (userLoginResponse.status !== 302 || !userSession) throw new Error("Normal User login failed.");

  const userSettingsPage = await requestWithCookie("/settings?tab=profile", userSession);
  const userDeviceCsrf = extractCsrfToken(await userSettingsPage.text());
  const userDeviceSession = extractCookie(userSettingsPage) || userSession;
  const userDeviceRegistration = await requestWithCookie("/trusted-device/register", userDeviceSession, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: userDeviceCsrf, pinEnabled: "0" }).toString()
  });
  const userTrustedCookie = extractCookie(userDeviceRegistration, "store.trusted_device");
  if (!userTrustedCookie) throw new Error("User trusted-device registration failed.");

  const userLogoutPage = await requestWithCookie("/settings?tab=profile", userDeviceSession);
  const userLogoutCsrf = extractCsrfToken(await userLogoutPage.text());
  await requestWithCookie("/logout", userDeviceSession, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: userLogoutCsrf }).toString()
  });
  const userQuickLogin = await requestWithCookie("/login", userTrustedCookie);
  const userQuickSession = extractCookie(userQuickLogin);
  if (userQuickLogin.status !== 302 || !userQuickSession) throw new Error("User trusted-device login failed.");
  const userSalesPage = await requestWithCookie("/sales", userQuickSession);
  const userAccountsPage = await requestWithCookie("/users", userQuickSession);
  if (!userSalesPage.ok || userAccountsPage.status !== 302 || userAccountsPage.headers.get("location") !== "/") {
    throw new Error("Trusted-device login did not preserve User role permissions.");
  }

  const database = new DatabaseSync(smokeDbPath);
  try {
    database.prepare("UPDATE users SET is_active = 0 WHERE username = ?").run(quickLoginUsername);
  } finally {
    database.close();
  }
  const inactiveQuickLogin = await requestWithCookie("/login", userTrustedCookie);
  if (inactiveQuickLogin.status !== 200) throw new Error("Inactive user was allowed to quick-login.");

  const deleteDatabase = new DatabaseSync(smokeDbPath);
  try {
    deleteDatabase.exec("PRAGMA foreign_keys = ON");
    deleteDatabase.prepare("DELETE FROM users WHERE username = ?").run(quickLoginUsername);
  } finally {
    deleteDatabase.close();
  }
  const deletedQuickLogin = await requestWithCookie("/login", userTrustedCookie);
  if (deletedQuickLogin.status !== 200) throw new Error("Deleted user was allowed to quick-login.");

  console.log("Smoke test passed.");
}

try {
  await main();
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}
