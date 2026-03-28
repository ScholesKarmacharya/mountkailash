const db = require("./db");

function initializeDatabase() {
  try {
    // Create users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create customers table
    db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_code TEXT UNIQUE,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        notes TEXT,
        jars_outstanding INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create inventory table
    db.exec(`
      CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quantity INTEGER DEFAULT 0,
        price_per_jar DECIMAL(10, 2) DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 50,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create sales table
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        staff_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        sale_date DATE NOT NULL,
        price_per_jar DECIMAL(10, 2) NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
        cancelled_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (staff_id) REFERENCES users(id)
      )
    `);

    // Create returns table
    db.exec(`
      CREATE TABLE IF NOT EXISTS returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        staff_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        return_date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (staff_id) REFERENCES users(id)
      )
    `);

    // Create payments table
    db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        payment_date DATE NOT NULL,
        remarks TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      )
    `);

    // Insert sample data if tables are empty
    const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
    if (userCount.count === 0) {
      db.prepare(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`).run("admin", "admin12", "admin");
      console.log("✅ Sample admin user created (username: admin, password: admin12)");
    }

    const inventoryCount = db.prepare("SELECT COUNT(*) as count FROM inventory").get();
    if (inventoryCount.count === 0) {
      db.prepare(`INSERT INTO inventory (quantity, price_per_jar, low_stock_threshold) VALUES (?, ?, ?)`).run(100, 50, 20);
      console.log("✅ Sample inventory created");
    }

    console.log("✅ Database initialized successfully!");
  } catch (err) {
    console.error("❌ Database initialization error:", err);
  }
}

module.exports = initializeDatabase;
