const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const DB_NAME = process.env.DB_NAME || 'police_admin';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let pool;
const sessions = new Map();

function required(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    const err = new Error(`${name} is required`);
    err.status = 400;
    throw err;
  }
  return String(value).trim();
}

function optional(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim();
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    station_id: user.station_id,
    station_name: user.station_name || null
  };
}

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function getUserById(id) {
  const rows = await query(
    `SELECT u.id, u.name, u.username, u.role, u.station_id, s.name AS station_name
     FROM users u
     LEFT JOIN stations s ON s.id = u.station_id
     WHERE u.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = sessions.get(token);
    if (!session) return res.status(401).json({ message: 'Please sign in first.' });

    const user = await getUserById(session.userId);
    if (!user) {
      sessions.delete(token);
      return res.status(401).json({ message: 'User no longer exists.' });
    }
    req.token = token;
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin permission required.' });
  }
  next();
}

async function initDatabase() {
  const base = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });

  await base.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await base.end();

  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
  });

  await resetOldSchemaIfNeeded();

  await query(`
    CREATE TABLE IF NOT EXISTS stations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      code VARCHAR(30) NOT NULL UNIQUE,
      city VARCHAR(80) NOT NULL,
      address VARCHAR(255) NULL,
      phone VARCHAR(30) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      username VARCHAR(60) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('ADMIN', 'OFFICER') NOT NULL DEFAULT 'OFFICER',
      station_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS firs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fir_number VARCHAR(60) NOT NULL UNIQUE,
      complainant_name VARCHAR(120) NOT NULL,
      complainant_cnic VARCHAR(25) NOT NULL,
      complainant_phone VARCHAR(30) NOT NULL,
      incident_type VARCHAR(80) NOT NULL,
      incident_datetime DATETIME NOT NULL,
      location VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      status ENUM('Open', 'Investigating', 'Closed') NOT NULL DEFAULT 'Open',
      station_id INT NOT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE RESTRICT,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function tableExists(tableName) {
  const rows = await query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [DB_NAME, tableName]
  );
  return rows.length > 0;
}

async function hasColumn(tableName, columnName) {
  const rows = await query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, tableName, columnName]
  );
  return rows.length > 0;
}

async function resetOldSchemaIfNeeded() {
  const incompatibleUsers = await tableExists('users') && !(await hasColumn('users', 'id'));
  const incompatibleFirs = await tableExists('firs') && !(await hasColumn('firs', 'id'));
  const hasOldStations = await tableExists('police_stations');

  if (!incompatibleUsers && !incompatibleFirs && !hasOldStations) return;

  await query('SET FOREIGN_KEY_CHECKS = 0');
  await query('DROP TABLE IF EXISTS chat_messages');
  await query('DROP TABLE IF EXISTS firs');
  await query('DROP TABLE IF EXISTS users');
  await query('DROP TABLE IF EXISTS employees');
  await query('DROP TABLE IF EXISTS police_stations');
  await query('DROP TABLE IF EXISTS stations');
  await query('SET FOREIGN_KEY_CHECKS = 1');
  console.log('Old seed/demo schema found and replaced with the new minimal schema.');
}

app.get('/api/setup/status', async (req, res, next) => {
  try {
    const rows = await query('SELECT COUNT(*) AS total FROM users');
    res.json({ needsSetup: rows[0].total === 0 });
  } catch (err) {
    next(err);
  }
});

app.post('/api/setup/admin', async (req, res, next) => {
  try {
    const rows = await query('SELECT COUNT(*) AS total FROM users');
    if (rows[0].total > 0) return res.status(409).json({ message: 'Setup is already complete.' });

    const name = required(req.body.name, 'Name');
    const username = required(req.body.username, 'Username');
    const password = required(req.body.password, 'Password');
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, "ADMIN")',
      [name, username, hash]
    );
    res.status(201).json({ id: result.insertId, message: 'Admin account created. You can sign in now.' });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const username = required(req.body.username, 'Username');
    const password = required(req.body.password, 'Password');
    const rows = await query(
      `SELECT u.*, s.name AS station_name
       FROM users u
       LEFT JOIN stations s ON s.id = u.station_id
       WHERE u.username = ?`,
      [username]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id });
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/logout', auth, (req, res) => {
  sessions.delete(req.token);
  res.json({ message: 'Signed out.' });
});

app.get('/api/stations', auth, async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM stations ORDER BY name');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.post('/api/stations', auth, adminOnly, async (req, res, next) => {
  try {
    const name = required(req.body.name, 'Station name');
    const code = required(req.body.code, 'Station code');
    const city = required(req.body.city, 'City');
    const address = optional(req.body.address);
    const phone = optional(req.body.phone);
    const result = await query(
      'INSERT INTO stations (name, code, city, address, phone) VALUES (?, ?, ?, ?, ?)',
      [name, code, city, address, phone]
    );
    res.status(201).json({ id: result.insertId, message: 'Station created.' });
  } catch (err) {
    next(err);
  }
});

app.put('/api/stations/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const name = required(req.body.name, 'Station name');
    const code = required(req.body.code, 'Station code');
    const city = required(req.body.city, 'City');
    const address = optional(req.body.address);
    const phone = optional(req.body.phone);
    await query(
      'UPDATE stations SET name = ?, code = ?, city = ?, address = ?, phone = ? WHERE id = ?',
      [name, code, city, address, phone, req.params.id]
    );
    res.json({ message: 'Station updated.' });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/stations/:id', auth, adminOnly, async (req, res, next) => {
  try {
    await query('DELETE FROM stations WHERE id = ?', [req.params.id]);
    res.json({ message: 'Station deleted.' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/users', auth, adminOnly, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT u.id, u.name, u.username, u.role, u.station_id, u.created_at, s.name AS station_name
       FROM users u
       LEFT JOIN stations s ON s.id = u.station_id
       ORDER BY u.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.post('/api/users', auth, adminOnly, async (req, res, next) => {
  try {
    const name = required(req.body.name, 'Name');
    const username = required(req.body.username, 'Username');
    const password = required(req.body.password, 'Password');
    const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'OFFICER';
    const stationId = role === 'ADMIN' ? null : optional(req.body.station_id);
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO users (name, username, password_hash, role, station_id) VALUES (?, ?, ?, ?, ?)',
      [name, username, hash, role, stationId]
    );
    res.status(201).json({ id: result.insertId, message: 'User created.' });
  } catch (err) {
    next(err);
  }
});

app.put('/api/users/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const name = required(req.body.name, 'Name');
    const username = required(req.body.username, 'Username');
    const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'OFFICER';
    const stationId = role === 'ADMIN' ? null : optional(req.body.station_id);
    const password = optional(req.body.password);

    if (password) {
      if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });
      const hash = await bcrypt.hash(password, 10);
      await query(
        'UPDATE users SET name = ?, username = ?, role = ?, station_id = ?, password_hash = ? WHERE id = ?',
        [name, username, role, stationId, hash, req.params.id]
      );
    } else {
      await query(
        'UPDATE users SET name = ?, username = ?, role = ?, station_id = ? WHERE id = ?',
        [name, username, role, stationId, req.params.id]
      );
    }
    res.json({ message: 'User updated.' });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own signed-in account.' });
    }
    await query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'User deleted.' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/firs', auth, async (req, res, next) => {
  try {
    const params = [];
    let where = '';
    if (req.user.role !== 'ADMIN') {
      where = 'WHERE f.station_id = ?';
      params.push(req.user.station_id || 0);
    }
    const rows = await query(
      `SELECT f.*, s.name AS station_name, s.code AS station_code, u.name AS created_by_name
       FROM firs f
       JOIN stations s ON s.id = f.station_id
       LEFT JOIN users u ON u.id = f.created_by
       ${where}
       ORDER BY f.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.post('/api/firs', auth, async (req, res, next) => {
  try {
    const stationId = req.user.role === 'ADMIN'
      ? required(req.body.station_id, 'Station')
      : req.user.station_id;
    if (!stationId) return res.status(400).json({ message: 'Officer account must be assigned to a station.' });

    const firNumber = required(req.body.fir_number, 'FIR number');
    const complainantName = required(req.body.complainant_name, 'Complainant name');
    const complainantCnic = required(req.body.complainant_cnic, 'Complainant CNIC');
    const complainantPhone = required(req.body.complainant_phone, 'Complainant phone');
    const incidentType = required(req.body.incident_type, 'Incident type');
    const incidentDatetime = required(req.body.incident_datetime, 'Incident date/time');
    const location = required(req.body.location, 'Location');
    const description = required(req.body.description, 'Description');
    const status = ['Open', 'Investigating', 'Closed'].includes(req.body.status) ? req.body.status : 'Open';

    const result = await query(
      `INSERT INTO firs
       (fir_number, complainant_name, complainant_cnic, complainant_phone, incident_type,
        incident_datetime, location, description, status, station_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [firNumber, complainantName, complainantCnic, complainantPhone, incidentType,
        incidentDatetime, location, description, status, stationId, req.user.id]
    );
    res.status(201).json({ id: result.insertId, message: 'FIR created.' });
  } catch (err) {
    next(err);
  }
});

app.put('/api/firs/:id', auth, async (req, res, next) => {
  try {
    const existing = await query('SELECT * FROM firs WHERE id = ?', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ message: 'FIR not found.' });
    if (req.user.role !== 'ADMIN' && existing[0].station_id !== req.user.station_id) {
      return res.status(403).json({ message: 'You can only update FIRs for your station.' });
    }

    const stationId = req.user.role === 'ADMIN'
      ? required(req.body.station_id, 'Station')
      : existing[0].station_id;
    const status = ['Open', 'Investigating', 'Closed'].includes(req.body.status) ? req.body.status : 'Open';
    await query(
      `UPDATE firs SET
        fir_number = ?, complainant_name = ?, complainant_cnic = ?, complainant_phone = ?,
        incident_type = ?, incident_datetime = ?, location = ?, description = ?, status = ?, station_id = ?
       WHERE id = ?`,
      [
        required(req.body.fir_number, 'FIR number'),
        required(req.body.complainant_name, 'Complainant name'),
        required(req.body.complainant_cnic, 'Complainant CNIC'),
        required(req.body.complainant_phone, 'Complainant phone'),
        required(req.body.incident_type, 'Incident type'),
        required(req.body.incident_datetime, 'Incident date/time'),
        required(req.body.location, 'Location'),
        required(req.body.description, 'Description'),
        status,
        stationId,
        req.params.id
      ]
    );
    res.json({ message: 'FIR updated.' });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/firs/:id', auth, async (req, res, next) => {
  try {
    const existing = await query('SELECT * FROM firs WHERE id = ?', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ message: 'FIR not found.' });
    if (req.user.role !== 'ADMIN' && existing[0].station_id !== req.user.station_id) {
      return res.status(403).json({ message: 'You can only delete FIRs for your station.' });
    }
    await query('DELETE FROM firs WHERE id = ?', [req.params.id]);
    res.json({ message: 'FIR deleted.' });
  } catch (err) {
    next(err);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  const duplicate = err && err.code === 'ER_DUP_ENTRY';
  const foreignKey = err && (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_NO_REFERENCED_ROW_2');
  const status = err.status || (duplicate ? 409 : foreignKey ? 400 : 500);
  const message = duplicate
    ? 'Duplicate value found. Please use a unique username, station code, or FIR number.'
    : foreignKey
      ? 'This record is linked to another record. Update or remove the linked record first.'
      : err.message || 'Server error.';
  res.status(status).json({ message });
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Police administration app running at http://localhost:${PORT}`);
      console.log(`Using MySQL database: ${DB_NAME}`);
    });
  })
  .catch((err) => {
    console.error('Could not start because MySQL connection failed.');
    console.error(err.message);
    process.exit(1);
  });
