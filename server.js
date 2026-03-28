const db = require("./db");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

const requireAuth = (req, res, next) => {
  const userId = req.headers["x-user-id"];
  const userRole = req.headers["x-user-role"];

  if (!userId || !userRole) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  req.user = {
    id: Number(userId),
    role: userRole
  };

  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }
  next();
};

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const sql = "SELECT * FROM users WHERE username = ? AND password = ?";

  db.query(sql, [username, password], (err, result) => {
    if (err) {
      console.log("Login DB error:", err);
      return res.status(500).json({ message: "Server error" });
    }

    if (result.length === 0) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const user = result[0];

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  });
});

app.post("/customers", requireAuth, requireAdmin, (req, res) => {
  const { customer_code, name, phone, address, notes } = req.body;

  if (!name) {
    return res.status(400).json({ message: "Customer name is required" });
  }

  const sql = `
    INSERT INTO customers (customer_code, name, phone, address, notes)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [customer_code || null, name, phone || null, address || null, notes || null],
    (err) => {
      if (err) {
        console.log("Add customer error:", err);
        return res.status(500).json({ message: "Error adding customer" });
      }

      res.json({ message: "Customer added successfully" });
    }
  );
});

app.get("/customers", requireAuth, (req, res) => {
  const search = req.query.search || "";

  const sql = `
    SELECT
      c.*,
      COALESCE((
        SELECT SUM(total_amount)
        FROM sales
        WHERE customer_id = c.id AND status = 'completed'
      ), 0) AS total_sales_amount,
      COALESCE((
        SELECT SUM(amount)
        FROM payments
        WHERE customer_id = c.id
      ), 0) AS total_paid_amount
    FROM customers c
    WHERE c.name LIKE ? OR c.phone LIKE ? OR c.customer_code LIKE ?
    ORDER BY c.id DESC
  `;

  const value = `%${search}%`;

  db.query(sql, [value, value, value], (err, result) => {
    if (err) {
      console.log("Fetch customers error:", err);
      return res.status(500).json({ message: "Error fetching customers" });
    }

    const updated = result.map((customer) => ({
      ...customer,
      due_amount:
        Number(customer.total_sales_amount || 0) -
        Number(customer.total_paid_amount || 0)
    }));

    res.json(updated);
  });
});

app.put("/customers/:id", requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { customer_code, name, phone, address, notes } = req.body;

  const sql = `
    UPDATE customers
    SET customer_code = ?, name = ?, phone = ?, address = ?, notes = ?
    WHERE id = ?
  `;

  db.query(
    sql,
    [customer_code || null, name, phone || null, address || null, notes || null, id],
    (err) => {
      if (err) {
        console.log("Update customer error:", err);
        return res.status(500).json({ message: "Error updating customer" });
      }

      res.json({ message: "Customer updated successfully" });
    }
  );
});

app.delete("/customers/:id", requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  db.query("DELETE FROM customers WHERE id = ?", [id], (err) => {
    if (err) {
      console.log("Delete customer error:", err);
      return res.status(500).json({ message: "Error deleting customer" });
    }

    res.json({ message: "Customer deleted successfully" });
  });
});

app.get("/stock", requireAuth, (req, res) => {
  db.query("SELECT * FROM inventory LIMIT 1", (err, result) => {
    if (err) {
      console.log("Stock fetch error:", err);
      return res.status(500).json({ message: "Error fetching stock" });
    }

    const stock = result[0];
    const lowStock = stock.quantity <= stock.low_stock_threshold;

    res.json({
      ...stock,
      lowStock
    });
  });
});

app.post("/stock/refill", requireAuth, requireAdmin, (req, res) => {
  const { added_quantity, price_per_jar, low_stock_threshold } = req.body;

  if (!added_quantity || Number(added_quantity) <= 0) {
    return res.status(400).json({ message: "Valid added quantity is required" });
  }

  const sql = `
    UPDATE inventory
    SET quantity = quantity + ?,
        price_per_jar = COALESCE(?, price_per_jar),
        low_stock_threshold = COALESCE(?, low_stock_threshold)
  `;

  db.query(
    sql,
    [
      Number(added_quantity),
      price_per_jar !== "" && price_per_jar !== undefined ? Number(price_per_jar) : null,
      low_stock_threshold !== "" && low_stock_threshold !== undefined ? Number(low_stock_threshold) : null
    ],
    (err) => {
      if (err) {
        console.log("Stock refill error:", err);
        return res.status(500).json({ message: "Error refilling stock" });
      }

      res.json({ message: "Stock updated successfully" });
    }
  );
});

app.post("/sales", requireAuth, (req, res) => {
  const { customer_id, quantity } = req.body;
  const staff_id = req.user.id;

  if (!customer_id || !quantity || Number(quantity) <= 0) {
    return res.status(400).json({ message: "Valid customer and quantity are required" });
  }

  db.query("SELECT * FROM inventory LIMIT 1", (err, stockResult) => {
    if (err) {
      console.log("Stock check error:", err);
      return res.status(500).json({ message: "Error checking stock" });
    }

    const stock = stockResult[0];

    if (stock.quantity < Number(quantity)) {
      return res.status(400).json({ message: "Not enough stock" });
    }

    const pricePerJar = Number(stock.price_per_jar);
    const totalAmount = Number(quantity) * pricePerJar;

    const saleSql = `
      INSERT INTO sales (
        customer_id, staff_id, quantity, sale_date, price_per_jar, total_amount
      )
      VALUES (?, ?, ?, CURDATE(), ?, ?)
    `;

    db.query(
      saleSql,
      [customer_id, staff_id, Number(quantity), pricePerJar, totalAmount],
      (err) => {
        if (err) {
          console.log("Sale save error:", err);
          return res.status(500).json({ message: "Error saving sale" });
        }

        db.query(
          "UPDATE inventory SET quantity = quantity - ?",
          [Number(quantity)],
          (err) => {
            if (err) {
              console.log("Stock update error:", err);
              return res.status(500).json({ message: "Error updating stock" });
            }

            db.query(
              "UPDATE customers SET jars_outstanding = jars_outstanding + ? WHERE id = ?",
              [Number(quantity), customer_id],
              (err) => {
                if (err) {
                  console.log("Outstanding update error:", err);
                  return res.status(500).json({ message: "Sale saved, but failed to update customer jar balance" });
                }

                res.json({ message: "Sale recorded successfully" });
              }
            );
          }
        );
      }
    );
  });
});

app.get("/sales", requireAuth, (req, res) => {
  const { from, to } = req.query;

  let sql = `
    SELECT
      s.id,
      c.name AS customer,
      u.username AS staff,
      s.quantity,
      s.price_per_jar,
      s.total_amount,
      s.sale_date,
      s.status
    FROM sales s
    JOIN customers c ON s.customer_id = c.id
    JOIN users u ON s.staff_id = u.id
    WHERE 1 = 1
  `;

  const params = [];

  if (from) {
    sql += " AND s.sale_date >= ?";
    params.push(from);
  }

  if (to) {
    sql += " AND s.sale_date <= ?";
    params.push(to);
  }

  sql += " ORDER BY s.id DESC";

  db.query(sql, params, (err, result) => {
    if (err) {
      console.log("Sales error:", err);
      return res.status(500).json({ message: "Error fetching sales" });
    }

    res.json(result);
  });
});

app.put("/sales/:id/cancel", requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  db.query("SELECT * FROM sales WHERE id = ?", [id], (err, result) => {
    if (err) {
      console.log("Fetch sale error:", err);
      return res.status(500).json({ message: "Error finding sale" });
    }

    if (result.length === 0) {
      return res.status(404).json({ message: "Sale not found" });
    }

    const sale = result[0];

    if (sale.status === "cancelled") {
      return res.status(400).json({ message: "Sale already cancelled" });
    }

    db.query(
      "UPDATE sales SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?",
      [id],
      (err) => {
        if (err) {
          console.log("Cancel sale error:", err);
          return res.status(500).json({ message: "Error cancelling sale" });
        }

        db.query(
          "UPDATE inventory SET quantity = quantity + ?",
          [sale.quantity],
          (err) => {
            if (err) {
              console.log("Restore stock error:", err);
              return res.status(500).json({ message: "Error restoring stock" });
            }

            db.query(
              "UPDATE customers SET jars_outstanding = GREATEST(jars_outstanding - ?, 0) WHERE id = ?",
              [sale.quantity, sale.customer_id],
              (err) => {
                if (err) {
                  console.log("Outstanding restore error:", err);
                  return res.status(500).json({ message: "Sale cancelled, but failed to restore customer jar balance" });
                }

                res.json({ message: "Sale cancelled and stock restored" });
              }
            );
          }
        );
      }
    );
  });
});

app.post("/returns", requireAuth, (req, res) => {
  const { customer_id, quantity } = req.body;
  const staff_id = req.user.id;

  if (!customer_id || !quantity || Number(quantity) <= 0) {
    return res.status(400).json({ message: "Valid customer and quantity are required" });
  }

  db.query("SELECT jars_outstanding FROM customers WHERE id = ?", [customer_id], (err, result) => {
    if (err) {
      console.log("Return check error:", err);
      return res.status(500).json({ message: "Error checking customer jar balance" });
    }

    if (result.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const outstanding = Number(result[0].jars_outstanding);

    if (Number(quantity) > outstanding) {
      return res.status(400).json({ message: "Return quantity exceeds jars with customer" });
    }

    const returnSql = `
      INSERT INTO returns (customer_id, staff_id, quantity, return_date)
      VALUES (?, ?, ?, CURDATE())
    `;

    db.query(returnSql, [customer_id, staff_id, Number(quantity)], (err) => {
      if (err) {
        console.log("Return save error:", err);
        return res.status(500).json({ message: "Error saving return" });
      }

      db.query(
        "UPDATE customers SET jars_outstanding = jars_outstanding - ? WHERE id = ?",
        [Number(quantity), customer_id],
        (err) => {
          if (err) {
            console.log("Outstanding return error:", err);
            return res.status(500).json({ message: "Return saved, but failed to update customer jar balance" });
          }

          res.json({ message: "Return recorded successfully" });
        }
      );
    });
  });
});

app.get("/returns", requireAuth, (req, res) => {
  const { from, to } = req.query;

  let sql = `
    SELECT
      r.id,
      c.name AS customer,
      u.username AS staff,
      r.quantity,
      r.return_date
    FROM returns r
    JOIN customers c ON r.customer_id = c.id
    JOIN users u ON r.staff_id = u.id
    WHERE 1 = 1
  `;

  const params = [];

  if (from) {
    sql += " AND r.return_date >= ?";
    params.push(from);
  }

  if (to) {
    sql += " AND r.return_date <= ?";
    params.push(to);
  }

  sql += " ORDER BY r.id DESC";

  db.query(sql, params, (err, result) => {
    if (err) {
      console.log("Returns error:", err);
      return res.status(500).json({ message: "Error fetching returns" });
    }

    res.json(result);
  });
});

app.post("/payments", requireAuth, (req, res) => {
  const { customer_id, amount, remarks } = req.body;

  if (!customer_id || !amount || Number(amount) <= 0) {
    return res.status(400).json({ message: "Valid customer and amount are required" });
  }

  const sql = `
    INSERT INTO payments (customer_id, amount, payment_date, remarks)
    VALUES (?, ?, CURDATE(), ?)
  `;

  db.query(sql, [customer_id, Number(amount), remarks || null], (err) => {
    if (err) {
      console.log("Payment save error:", err);
      return res.status(500).json({ message: "Error saving payment" });
    }

    res.json({ message: "Payment recorded successfully" });
  });
});

app.get("/payments", requireAuth, (req, res) => {
  const { customer_id } = req.query;

  let sql = `
    SELECT
      p.id,
      c.name AS customer,
      p.amount,
      p.payment_date,
      p.remarks
    FROM payments p
    JOIN customers c ON p.customer_id = c.id
  `;

  const params = [];

  if (customer_id) {
    sql += " WHERE p.customer_id = ?";
    params.push(customer_id);
  }

  sql += " ORDER BY p.id DESC";

  db.query(sql, params, (err, result) => {
    if (err) {
      console.log("Payments fetch error:", err);
      return res.status(500).json({ message: "Error fetching payments" });
    }

    res.json(result);
  });
});

app.get("/customer-ledger/:id", requireAuth, (req, res) => {
  const { id } = req.params;

  const summarySql = `
    SELECT
      c.id,
      c.name,
      c.phone,
      c.address,
      c.customer_code,
      c.notes,
      c.jars_outstanding,
      COALESCE((
        SELECT SUM(total_amount)
        FROM sales
        WHERE customer_id = c.id AND status = 'completed'
      ), 0) AS total_sales_amount,
      COALESCE((
        SELECT SUM(amount)
        FROM payments
        WHERE customer_id = c.id
      ), 0) AS total_paid_amount
    FROM customers c
    WHERE c.id = ?
  `;

  db.query(summarySql, [id], (err, customerResult) => {
    if (err) {
      console.log("Ledger summary error:", err);
      return res.status(500).json({ message: "Error fetching customer summary" });
    }

    if (customerResult.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const customer = customerResult[0];
    customer.due_amount =
      Number(customer.total_sales_amount) - Number(customer.total_paid_amount);

    db.query(
      `
      SELECT id, quantity, total_amount, sale_date, status
      FROM sales
      WHERE customer_id = ?
      ORDER BY id DESC
      `,
      [id],
      (err, salesResult) => {
        if (err) {
          console.log("Ledger sales error:", err);
          return res.status(500).json({ message: "Error fetching sales ledger" });
        }

        db.query(
          `
          SELECT id, quantity, return_date
          FROM returns
          WHERE customer_id = ?
          ORDER BY id DESC
          `,
          [id],
          (err, returnsResult) => {
            if (err) {
              console.log("Ledger returns error:", err);
              return res.status(500).json({ message: "Error fetching return ledger" });
            }

            db.query(
              `
              SELECT id, amount, payment_date, remarks
              FROM payments
              WHERE customer_id = ?
              ORDER BY id DESC
              `,
              [id],
              (err, paymentsResult) => {
                if (err) {
                  console.log("Ledger payments error:", err);
                  return res.status(500).json({ message: "Error fetching payment ledger" });
                }

                res.json({
                  customer,
                  sales: salesResult,
                  returns: returnsResult,
                  payments: paymentsResult
                });
              }
            );
          }
        );
      }
    );
  });
});

app.get("/dashboard/summary", requireAuth, (req, res) => {
  const summary = {};

  db.query("SELECT quantity, price_per_jar, low_stock_threshold FROM inventory LIMIT 1", (err, stockResult) => {
    if (err) {
      return res.status(500).json({ message: "Error fetching inventory summary" });
    }

    summary.stock = stockResult[0];

    db.query("SELECT COUNT(*) AS total_customers FROM customers", (err, customerResult) => {
      if (err) {
        return res.status(500).json({ message: "Error fetching customer summary" });
      }

      summary.total_customers = customerResult[0].total_customers;

      db.query("SELECT COALESCE(SUM(jars_outstanding), 0) AS total_jars_with_customers FROM customers", (err, outstandingResult) => {
        if (err) {
          return res.status(500).json({ message: "Error fetching jar outstanding summary" });
        }

        summary.total_jars_with_customers = outstandingResult[0].total_jars_with_customers;

        db.query(
          "SELECT COALESCE(SUM(quantity), 0) AS jars_sold_today, COALESCE(SUM(total_amount), 0) AS revenue_today FROM sales WHERE sale_date = CURDATE() AND status = 'completed'",
          (err, todayResult) => {
            if (err) {
              return res.status(500).json({ message: "Error fetching today summary" });
            }

            summary.jars_sold_today = todayResult[0].jars_sold_today;
            summary.revenue_today = todayResult[0].revenue_today;

            db.query(
              "SELECT COALESCE(SUM(quantity), 0) AS jars_sold_month, COALESCE(SUM(total_amount), 0) AS revenue_month FROM sales WHERE MONTH(sale_date) = MONTH(CURDATE()) AND YEAR(sale_date) = YEAR(CURDATE()) AND status = 'completed'",
              (err, monthResult) => {
                if (err) {
                  return res.status(500).json({ message: "Error fetching month summary" });
                }

                summary.jars_sold_month = monthResult[0].jars_sold_month;
                summary.revenue_month = monthResult[0].revenue_month;

                db.query(
                  "SELECT COALESCE(SUM(quantity), 0) AS jars_returned_today FROM returns WHERE return_date = CURDATE()",
                  (err, returnTodayResult) => {
                    if (err) {
                      return res.status(500).json({ message: "Error fetching return summary" });
                    }

                    summary.jars_returned_today = returnTodayResult[0].jars_returned_today;

                    res.json(summary);
                  }
                );
              }
            );
          }
        );
      });
    });
  });
});

app.get("/staff/today-summary", requireAuth, (req, res) => {
  const staffId = req.user.id;

  const sql = `
    SELECT
      COALESCE(SUM(quantity), 0) AS total_jars_sold,
      COALESCE(SUM(total_amount), 0) AS total_sales_amount
    FROM sales
    WHERE staff_id = ? AND sale_date = CURDATE() AND status = 'completed'
  `;

  db.query(sql, [staffId], (err, result) => {
    if (err) {
      console.log("Staff today summary error:", err);
      return res.status(500).json({ message: "Error fetching staff summary" });
    }

    res.json(result[0]);
  });
});

app.get("/staff/recent-sales", requireAuth, (req, res) => {
  const staffId = req.user.id;

  const sql = `
    SELECT
      s.id,
      c.name AS customer,
      s.quantity,
      s.total_amount,
      s.sale_date,
      s.created_at
    FROM sales s
    JOIN customers c ON s.customer_id = c.id
    WHERE s.staff_id = ? AND s.status = 'completed'
    ORDER BY s.id DESC
    LIMIT 5
  `;

  db.query(sql, [staffId], (err, result) => {
    if (err) {
      console.log("Staff recent sales error:", err);
      return res.status(500).json({ message: "Error fetching recent sales" });
    }

    res.json(result);
  });
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});