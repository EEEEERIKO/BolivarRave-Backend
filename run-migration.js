#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const pg = require("pg");
const dotenv = require("dotenv");

// Load .env
dotenv.config();

const { Client } = pg;

const sqlPath = path.join(process.cwd(), "prisma", "sql", "009_staff_schema.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL or DIRECT_URL environment variable not set");
  process.exit(1);
}

console.log("🔌 Connecting to database...");
console.log(`   Host: ${new URL(connectionString).hostname}`);

const client = new Client({ connectionString });

(async () => {
  try {
    await client.connect();
    console.log("✅ Connected to database");

    console.log("📝 Executing migration SQL...");
    await client.query(sql);
    console.log("✅ Migration executed successfully!");

    // Verify tables were created
    const result = await client.query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename IN ('staff', 'staff_bloqueos_clase')
      ORDER BY tablename
    `);

    console.log("\n📊 Created tables:");
    result.rows.forEach(row => {
      console.log(`   • ${row.tablename}`);
    });

  } catch (error) {
    console.error("❌ Migration failed:");
    console.error(error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
