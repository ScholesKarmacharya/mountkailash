const Database = require("better-sqlite3");
const path = require("path");

// Use environment variable for database path, or default to local file
const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "mountkailash.db");

// Ensure data directory exists
const fs = require("fs");
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable foreign keys
db.pragma("foreign_keys = ON");

// Wrapper for consistency with async callback style
db.query = function(sql, params = [], callback) {
  try {
    if (typeof params === "function") {
      callback = params;
      params = [];
    }
    
    let result;
    if (sql.trim().toUpperCase().startsWith("SELECT")) {
      result = this.prepare(sql).all(...params);
      callback(null, result);
    } else {
      const stmt = this.prepare(sql);
      const info = stmt.run(...params);
      callback(null, { changes: info.changes, lastID: info.lastInsertRowid });
    }
  } catch (err) {
    callback(err);
  }
};

console.log("SQLite Connected");

module.exports = db;