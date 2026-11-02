require("dotenv").config();
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const file = path.resolve(process.env.DB_FILE || "./data/support.db");
fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new Database(file);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Creates the table and indexes on first run; does nothing afterwards.
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

// Run a SELECT and get all rows back. params: { name: value } matching @name in the SQL.
const all = (text, params = {}) => db.prepare(text).all(params);

module.exports = { db, all, file };
