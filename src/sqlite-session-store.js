import session from "express-session";
import { db } from "./db.js";

function withStoreCallback(callback, fn) {
  try {
    fn();
  } catch (error) {
    callback(error);
  }
}

export class SQLiteSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.defaultTtlMs = Number(options.defaultTtlMs || 30 * 60 * 1000);
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON app_sessions(expires_at);
    `);
  }

  pruneExpired(now = Date.now()) {
    db.prepare("DELETE FROM app_sessions WHERE expires_at <= ?").run(now);
  }

  resolveExpiry(sessionData) {
    const cookieExpiry = sessionData?.cookie?.expires ? new Date(sessionData.cookie.expires).getTime() : 0;
    if (cookieExpiry && Number.isFinite(cookieExpiry)) return cookieExpiry;
    const originalMaxAge = Number(sessionData?.cookie?.originalMaxAge || 0);
    if (originalMaxAge > 0) return Date.now() + originalMaxAge;
    return Date.now() + this.defaultTtlMs;
  }

  get(sid, callback = () => {}) {
    withStoreCallback(callback, () => {
      this.pruneExpired();
      const row = db.prepare("SELECT sess, expires_at FROM app_sessions WHERE sid = ?").get(sid);
      if (!row) return callback(null, null);
      if (Number(row.expires_at || 0) <= Date.now()) {
        db.prepare("DELETE FROM app_sessions WHERE sid = ?").run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(String(row.sess || "{}")));
    });
  }

  set(sid, sessionData, callback = () => {}) {
    withStoreCallback(callback, () => {
      this.pruneExpired();
      const expiresAt = this.resolveExpiry(sessionData);
      db.prepare(`
        INSERT INTO app_sessions (sid, sess, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          sess = excluded.sess,
          expires_at = excluded.expires_at
      `).run(sid, JSON.stringify(sessionData), expiresAt);
      callback(null);
    });
  }

  destroy(sid, callback = () => {}) {
    withStoreCallback(callback, () => {
      db.prepare("DELETE FROM app_sessions WHERE sid = ?").run(sid);
      callback(null);
    });
  }

  touch(sid, sessionData, callback = () => {}) {
    withStoreCallback(callback, () => {
      const expiresAt = this.resolveExpiry(sessionData);
      db.prepare("UPDATE app_sessions SET expires_at = ?, sess = ? WHERE sid = ?")
        .run(expiresAt, JSON.stringify(sessionData), sid);
      callback(null);
    });
  }

  clear(callback = () => {}) {
    withStoreCallback(callback, () => {
      db.prepare("DELETE FROM app_sessions").run();
      callback(null);
    });
  }
}
