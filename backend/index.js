require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));

// Configure multer for PDF file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'Uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for PDF files
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  },
});

// Create MySQL connection pool with validation
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'travel_db',
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
});
if (!process.env.DB_HOST || !process.env.DB_NAME) {
  console.error('❌ Missing required .env variables (DB_HOST or DB_NAME)');
  process.exit(1);
}

(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL connected');
    connection.release();
  } catch (err) {
    console.error('❌ DB connection failed:', err.message);
    process.exit(1);
  }
})();

// Improved date parsing function with validation
function parseDMYtoYMD(input) {
  if (!input) return null;
  if (!isNaN(input)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 31)); // Correct Excel epoch
    const msPerDay = 24 * 60 * 60 * 1000;
    const date = new Date(excelEpoch.getTime() + (Number(input) - 1) * msPerDay);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    return null;
  }
  const cleaned = input.toString().replace(/[\r\n"']/g, '').trim();
  const parts = cleaned.split(/[/\-\.]/);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate()) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

// Cache management
const graphCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function setCache(key, value) { graphCache.set(key, { value, expiry: Date.now() + CACHE_TTL }); }
function getCache(key) { const cached = graphCache.get(key); if (cached && cached.expiry > Date.now()) return cached.value; graphCache.delete(key); return null; }
function invalidateCache(key) {
  graphCache.delete(key);
  if (key === '/employees' || key === '/travels') graphCache.delete('/travels'); // Invalidate related caches
}

// === Upload Employees Excel ===
app.post('/upload', async (req, res) => {
  const { fileContent } = req.body;
  if (!fileContent || !Array.isArray(fileContent)) return res.status(400).json({ error: 'No valid data provided' });
  let connection;
  try {
    const values = fileContent.map(row => [row['Official Station'] || '', row['Name'] || '', row['Position'] || '', row['Initial'] || '', row['sof'] || '']);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const query = 'INSERT INTO Employee (office, fullname, positionTitle, Initial, sof) VALUES ? ON DUPLICATE KEY UPDATE office=office';
    const [result] = await connection.query(query, [values]);
    await connection.commit();
    invalidateCache('/employees');
    res.status(201).json({ message: `${result.affectedRows} employees inserted/updated` });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(500).json({ error: 'Failed to process data', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// === Upload TravelAuthority Excel ===
app.post('/upload-travels', async (req, res) => {
  const { fileContent } = req.body;
  if (!fileContent || !Array.isArray(fileContent)) return res.status(400).json({ error: 'No valid data provided' });
  let connection;
  try {
    const values = [];
    fileContent.forEach(row => {
      const names = row['Name'] ? row['Name'].split(';').map(n => n.trim()).filter(n => n) : [''];
      const initials = row['Initial'] ? row['Initial'].split(';').map(i => i.trim()).filter(i => i) : [''];
      const positions = row['PositionDesignation'] ? row['PositionDesignation'].split(';').map(p => p.trim()).filter(p => p) : [''];
      const sofs = row['sof'] ? row['sof'].split(';').map(s => s.trim()).filter(s => s) : [''];
      names.forEach((name, index) => {
        values.push([initials[index] || '', name, positions[index] || row['PositionDesignation'] || '', row['Station'] || '', row['Purpose'] || '', row['Host'] || '', parseDMYtoYMD(row['DatesFrom']), parseDMYtoYMD(row['DatesTo']), row['Destination'] || '', row['Area'] || '', sofs[index] || row['sof'] || '']);
      });
    });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const query = 'INSERT INTO TravelAuthority (Initial, Name, PositionDesignation, Station, Purpose, Host, DatesFrom, DatesTo, Destination, Area, sof) VALUES ? ON DUPLICATE KEY UPDATE Initial=Initial';
    const [result] = await connection.query(query, [values]);
    await connection.commit();
    invalidateCache('/travels');
    res.status(201).json({ message: `${result.affectedRows} travel entries inserted/updated` });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(500).json({ error: 'Failed to process data', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// === Bulk JSON upload for TravelAuthority ===
app.post('/travels/bulk', async (req, res) => {
  const entries = req.body;
  console.log('Received entries:', JSON.stringify(entries, null, 2)); // Debug log
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'No data provided' });
  }

  const invalidEntries = entries.filter(e => 
    !e.employeeID || !e.positiondesignation || !e.station || !e.purpose || !e.host || !e.fromDate || !e.toDate || !e.destination || !e.area || !e.sof
  );
  if (invalidEntries.length > 0) {
    console.log('Invalid entries found:', invalidEntries);
    return res.status(400).json({ error: 'All fields are required', details: `Invalid entries: ${invalidEntries.map(e => JSON.stringify(e)).join(', ')}` });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    await connection.query('DELETE FROM TravelAuthority');

    const values = entries.map(e => [
      parseInt(e.employeeID),
      e.positiondesignation,
      e.station,
      e.purpose,
      e.host,
      parseDMYtoYMD(e.fromDate),
      parseDMYtoYMD(e.toDate),
      e.destination,
      e.area,
      e.sof
    ]).filter(row => row.every(f => f != null && f !== ''));

    if (!values.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'No valid data rows after parsing' });
    }

    const query = 'INSERT INTO TravelAuthority (employee_ID, PositionDesignation, Station, Purpose, Host, DatesFrom, DatesTo, Destination, Area, sof) VALUES ?';
    const [result] = await connection.query(query, [values]);

    await connection.commit();
    invalidateCache('/travels');
    res.status(201).json({ message: `${result.affectedRows} travel entries inserted` });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Bulk insertion error:', err);
    res.status(500).json({ error: 'Failed to insert travel entries', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// === CRUD TravelAuthority with Attachment Support ===
app.get('/travels', async (req, res) => {
  try {
    const [results] = await pool.query('SELECT * FROM TravelAuthority LEFT JOIN Employee ON Employee.uid = TravelAuthority.employee_ID');
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch travel entries', details: err.message });
  }
});

app.get('/travels/filter', async (req, res) => {
  const { name, initial, fromDate, toDate, sof } = req.query;
  let query = 'SELECT id, Initial, Name, PositionDesignation, Station, Purpose, Host, DATE_FORMAT(DatesFrom, \'%Y-%m-%d\') as DatesFrom, DATE_FORMAT(DatesTo, \'%Y-%m-%d\') as DatesTo, Destination, Area, sof, Attachment FROM TravelAuthority WHERE 1=1';
  const params = [];
  if (name) { query += ' AND Name LIKE ?'; params.push(`%${name}%`); }
  if (initial) { query += ' AND Initial = ?'; params.push(initial); }
  if (fromDate) { query += ' AND DatesFrom >= ?'; params.push(fromDate); }
  if (toDate) { query += ' AND DatesTo <= ?'; params.push(toDate); }
  if (sof) { query += ' AND sof LIKE ?'; params.push(`%${sof}%`); }
  if (params.length === 0) query += ' LIMIT 1000'; // Default limit if no filters
  query += ' ORDER BY DatesFrom DESC';
  try {
    const [results] = await pool.query(query, params);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch filtered travel entries', details: err.message });
  }
});

app.post('/travels', upload.single('attachment'), async (req, res) => {
  const { employeeID, positiondesignation, station, purpose, host, datesfrom, datesto, destination, area, sof } = req.body;
  if (!employeeID || !positiondesignation || !station || !purpose || !host || !datesfrom || !datesto || !destination || !area || !sof) {
    if (req.file) fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
    return res.status(400).json({ error: 'All fields are required', details: 'Missing one or more required fields' });
  }
  const attachmentPath = req.file ? `/uploads/${req.file.filename}` : null;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const query = 'INSERT INTO TravelAuthority (employee_ID, PositionDesignation, Station, Purpose, Host, DatesFrom, DatesTo, Destination, Area, sof, Attachment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const [result] = await connection.query(query, [employeeID, positiondesignation, station, purpose, host, datesfrom, datesto, destination, area, sof, attachmentPath]);
    await connection.commit();
    invalidateCache('/travels');
    res.status(201).json({ id: result.insertId, attachmentPath });
  } catch (err) {
    if (connection) await connection.rollback();
    if (req.file) fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
    res.status(500).json({ error: 'Failed to insert travel entry', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.put('/travels/:id', upload.single('attachment'), async (req, res) => {
  const { id } = req.params;
  const { employeeID, positiondesignation, station, purpose, host, datesfrom, datesto, destination, area, sof } = req.body;
  if (!employeeID || !positiondesignation || !station || !purpose || !host || !datesfrom || !datesto || !destination || !area || !sof) {
    if (req.file) fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
    return res.status(400).json({ error: 'All fields are required', details: 'Missing one or more required fields' });
  }
  const attachmentPath = req.file ? `/uploads/${req.file.filename}` : undefined;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT Attachment FROM TravelAuthority WHERE id = ?', [id]);
    if (!existing.length) {
      if (req.file) fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
      return res.status(404).json({ error: 'Travel entry not found' });
    }
    const oldAttachmentPath = existing[0].Attachment;
    let query = 'UPDATE TravelAuthority SET employee_ID = ?, PositionDesignation = ?, Station = ?, Purpose = ?, Host = ?, DatesFrom = ?, DatesTo = ?, Destination = ?, Area = ?, sof = ?';
    const params = [employeeID, positiondesignation, station, purpose, host, datesfrom, datesto, destination, area, sof];
    if (attachmentPath) {
      query += ', Attachment = ?';
      params.push(attachmentPath);
    } else if (oldAttachmentPath) {
      query += ', Attachment = ?';
      params.push(oldAttachmentPath);
    }
    query += ' WHERE id = ?';
    params.push(id);
    const [result] = await connection.query(query, params);
    if (result.affectedRows === 0) {
      await connection.rollback();
      if (req.file) fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
      return res.status(404).json({ error: 'Travel entry not found' });
    }
    if (req.file && oldAttachmentPath) {
      try {
        fs.unlinkSync(path.join(__dirname, 'Uploads', oldAttachmentPath.replace('/uploads/', '')));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete old attachment:', unlinkErr.message);
      }
    }
    await connection.commit();
    invalidateCache('/travels');
    res.json({ message: 'Travel entry updated', attachmentPath: attachmentPath || oldAttachmentPath });
  } catch (err) {
    if (connection) await connection.rollback();
    if (req.file) {
      try {
        fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete temporary file:', unlinkErr.message);
      }
    }
    res.status(500).json({ error: 'Failed to update travel entry', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.delete('/travels/:id', async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT Attachment FROM TravelAuthority WHERE id = ?', [id]);
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Travel entry not found' });
    }
    const attachmentPath = existing[0].Attachment;
    const [result] = await connection.query('DELETE FROM TravelAuthority WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Travel entry not found' });
    }
    if (attachmentPath) {
      try {
        fs.unlinkSync(path.join(__dirname, 'Uploads', attachmentPath.replace('/uploads/', '')));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete attachment:', unlinkErr.message);
      }
    }
    await connection.commit();
    invalidateCache('/travels');
    res.json({ message: 'Travel entry deleted' });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(500).json({ error: 'Failed to delete travel entry', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// === Selective Delete Endpoint for TravelAuthority ===
app.post('/travels/delete', async (req, res) => {
  const { ids, fromDate, toDate } = req.body;
  if (!ids && !fromDate && !toDate) return res.status(400).json({ error: 'At least one filter is required' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    let query = 'DELETE FROM TravelAuthority WHERE 1=1';
    const params = [];
    if (Array.isArray(ids) && ids.length) { query += ' AND id IN (?)'; params.push(ids); }
    if (fromDate) { query += ' AND DatesFrom >= ?'; params.push(parseDMYtoYMD(fromDate)); }
    if (toDate) { query += ' AND DatesTo <= ?'; params.push(parseDMYtoYMD(toDate)); }
    const [result] = await connection.query(query, params);
    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'No matching entries found' });
    }
    await connection.commit();
    invalidateCache('/travels');
    res.json({ message: `${result.affectedRows} travel entries deleted` });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(500).json({ error: 'Failed to delete travel entries', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// === CRUD Employee ===
app.get('/employees', async (req, res) => {
  try {
    const [results] = await pool.query('SELECT * FROM Employee');
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch employees', details: err.message });
  }
});

app.post('/employees', async (req, res) => {
  const { office, fullname, positionTitle, Initial, sof } = req.body;
  if (!office || !fullname || !positionTitle || !Initial) {
    return res.status(400).json({ error: 'All fields except sof are required', details: 'Missing one or more required fields' });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const query = 'INSERT INTO Employee (office, fullname, positionTitle, Initial, sof) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE office=office';
    const [result] = await connection.query(query, [office, fullname, positionTitle, Initial, sof || '']);
    await connection.commit();
    invalidateCache('/employees');
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(500).json({ error: 'Failed to insert employee', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.delete('/employees/:id', async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.query('DELETE FROM Employee WHERE uid = ?', [id]);
    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Employee not found' });
    }
    await connection.commit();
    invalidateCache('/employees');
    res.json({ message: 'Employee deleted' });
  } catch (err) {
    if (connection) await connection.rollback();
    res.status(500).json({ error: 'Failed to delete employee', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// === Graph Data API ===
app.get('/travels/graph', async (req, res) => {
  const { type, employee_ID, year, month, positionTitle } = req.query;
  if (!['year', 'month', 'week', 'date'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const employeeIdFilter = employee_ID ? parseInt(employee_ID) : null;
  if (employee_ID && isNaN(employeeIdFilter)) return res.status(400).json({ error: 'Invalid employee ID' });
  const cacheKey = `${type}-${employeeIdFilter || 'all'}-${year || 'all'}-${month || 'all'}-${positionTitle || 'all'}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);
  const groupFormat = {
    year: { label: 'YEAR(DatesFrom)', groupBy: 'YEAR(DatesFrom)', orderBy: 'YEAR(DatesFrom)' },
    month: { label: "CONCAT(YEAR(DatesFrom), '-', LPAD(MONTH(DatesFrom), 2, '0'))", groupBy: 'YEAR(DatesFrom), MONTH(DatesFrom)', orderBy: 'YEAR(DatesFrom), MONTH(DatesFrom)' },
    week: { label: "CONCAT(YEAR(DatesFrom), '-W', LPAD(WEEK(DatesFrom), 2, '0'))", groupBy: 'YEAR(DatesFrom), WEEK(DatesFrom)', orderBy: 'YEAR(DatesFrom), WEEK(DatesFrom)' },
    date: { label: "DATE_FORMAT(DatesFrom, '%Y-%m-%d')", groupBy: 'DATE(DatesFrom)', orderBy: 'DATE(DatesFrom)' },
  }[type] || { label: 'YEAR(DatesFrom)', groupBy: 'YEAR(DatesFrom)', orderBy: 'YEAR(DatesFrom)' }; // Default to year
  let query = `SELECT ${groupFormat.label} AS label, COUNT(*) AS count FROM TravelAuthority WHERE DatesFrom IS NOT NULL`;
  const params = [];
  if (employeeIdFilter) { query += ' AND employee_ID = ?'; params.push(employeeIdFilter); }
  if (year) { query += ' AND YEAR(DatesFrom) = ?'; params.push(year); }
  if (month) { query += ' AND MONTH(DatesFrom) = ?'; params.push(month); }
  if (positionTitle) { query += ' AND PositionDesignation LIKE ?'; params.push(`%${positionTitle}%`); }
  query += ` GROUP BY ${groupFormat.groupBy} ORDER BY ${groupFormat.orderBy}`;
  try {
    const [results] = await pool.query(query, params);
    const response = results.length
      ? { labels: results.map(r => r.label), datasets: [{ label: `Travel Entries by ${type}`, data: results.map(r => r.count), backgroundColor: 'rgba(75, 192, 192, 0.6)' }] }
      : { labels: [], datasets: [{ label: `Travel Entries by ${type}`, data: [], backgroundColor: 'rgba(75, 192, 192, 0.6)' }] };
    setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve graph data', details: err.message });
  }
});

// === Appointment CRUD ===


// GET all appointments
// Assume a simple in-memory cache (replace with your actual cache implementation)
const cache = new Map();

function getCache(key) {
  return cache.get(key);
}

function setCache(key, value) {
  cache.set(key, value);
}

function invalidateCache(key) {
  cache.delete(key);
}

function invalidateAllCacheForType(type) {
  const keysToInvalidate = Array.from(cache.keys()).filter(key => key.startsWith(`${type}-`));
  keysToInvalidate.forEach(invalidateCache);
}

// Validate appointment function remains unchanged
const validateAppointment = (a, checkAll = true) => {
  return (
    a.name && a.positionTitle && a.statusAppointment &&
    a.schoolOffice && a.DateSigned &&
    (!checkAll || a.natureAppointment !== undefined)
  );
};

// GET all appointments (no cache needed, so unchanged)
app.get('/appointments', async (req, res) => {
  try {
    const [results] = await pool.query('SELECT * FROM appointment');
    res.json(results);
  } catch (err) {
    console.error('Error fetching appointments:', err);
    res.status(500).json({ error: 'Failed to fetch appointments', details: err.message });
  }
});

// POST create appointment with PDF attachment
app.post('/appointments', upload.single('attachment'), async (req, res) => {
  const { name, positionTitle, statusAppointment, schoolOffice, natureAppointment = '', itemNo = '', DateSigned } = req.body;
  if (!validateAppointment(req.body, false)) {
    if (req.file) fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const attachmentPath = req.file ? `/uploads/${req.file.filename}` : null;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const query = `
      INSERT INTO appointment (name, positionTitle, statusAppointment, schoolOffice, natureAppointment, itemNo, DateSigned, pdfPath)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const [result] = await connection.query(query, [
      name,
      positionTitle,
      statusAppointment,
      schoolOffice,
      natureAppointment,
      itemNo,
      DateSigned,
      attachmentPath
    ]);
    await connection.commit();
    // Invalidate cache for all graph types since a new appointment affects all aggregations
    ['year', 'month', 'week', 'date'].forEach(invalidateAllCacheForType);
    res.status(201).json({ id: result.insertId, pdfPath: attachmentPath });
  } catch (err) {
    if (connection) await connection.rollback();
    if (req.file) fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
    console.error('Error inserting appointment:', err);
    res.status(500).json({ error: 'Failed to insert appointment', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// PUT update appointment with PDF attachment
app.put('/appointments/:id', upload.single('attachment'), async (req, res) => {
  const { id } = req.params;
  const { name, positionTitle, statusAppointment, schoolOffice, natureAppointment = '', itemNo = '', DateSigned } = req.body;
  if (!validateAppointment(req.body)) {
    if (req.file) fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const attachmentPath = req.file ? `/uploads/${req.file.filename}` : undefined;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT pdfPath FROM appointment WHERE id = ?', [id]);
    if (!existing.length) {
      if (req.file) fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
      return res.status(404).json({ error: 'Appointment not found' });
    }
    const oldAttachmentPath = existing[0].pdfPath;
    let query = `
      UPDATE appointment
      SET name = ?, positionTitle = ?, statusAppointment = ?, schoolOffice = ?, natureAppointment = ?, itemNo = ?, DateSigned = ?`;
    const params = [name, positionTitle, statusAppointment, schoolOffice, natureAppointment, itemNo, DateSigned];
    if (attachmentPath) {
      query += ', pdfPath = ?';
      params.push(attachmentPath);
    } else if (oldAttachmentPath) {
      query += ', pdfPath = ?';
      params.push(oldAttachmentPath);
    }
    query += ' WHERE id = ?';
    params.push(id);
    const [result] = await connection.query(query, params);
    if (result.affectedRows === 0) {
      await connection.rollback();
      if (req.file) fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (req.file && oldAttachmentPath) {
      try {
        fs.unlinkSync(path.join(__dirname, 'Uploads', oldAttachmentPath.replace('/uploads/', '')));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete old attachment:', unlinkErr.message);
      }
    }
    await connection.commit();
    // Invalidate cache for all graph types
    ['year', 'month', 'week', 'date'].forEach(invalidateAllCacheForType);
    res.json({ message: 'Appointment updated', pdfPath: attachmentPath || oldAttachmentPath });
  } catch (err) {
    if (connection) await connection.rollback();
    if (req.file) {
      try {
        fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete temporary file:', unlinkErr.message);
      }
    }
    console.error('Error updating appointment:', err);
    res.status(500).json({ error: 'Failed to update appointment', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE appointment
app.delete('/appointments/:id', async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT pdfPath FROM appointment WHERE id = ?', [id]);
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Appointment not found' });
    }
    const attachmentPath = existing[0].pdfPath;
    const [result] = await connection.query('DELETE FROM appointment WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (attachmentPath) {
      try {
        fs.unlinkSync(path.join(__dirname, 'Uploads', attachmentPath.replace('/uploads/', '')));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete attachment:', unlinkErr.message);
      }
    }
    await connection.commit();
    // Invalidate cache for all graph types
    ['year', 'month', 'week', 'date'].forEach(invalidateAllCacheForType);
    res.json({ message: 'Appointment deleted' });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error deleting appointment:', err);
    res.status(500).json({ error: 'Failed to delete appointment', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// POST selective delete appointments
app.post('/appointments/delete', async (req, res) => {
  const { ids, fromDate, toDate } = req.body;
  if (!ids && !fromDate && !toDate) return res.status(400).json({ error: 'At least one filter (ids, fromDate, or toDate) is required' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    
    let selectQuery = 'SELECT pdfPath FROM appointment WHERE 1=1';
    const selectParams = [];
    if (Array.isArray(ids) && ids.length) { selectQuery += ' AND id IN (?)'; selectParams.push(ids); }
    if (fromDate) { selectQuery += ' AND DateSigned >= ?'; selectParams.push(parseDMYtoYMD(fromDate)); }
    if (toDate) { selectQuery += ' AND DateSigned <= ?'; selectParams.push(parseDMYtoYMD(toDate)); }
    
    const [attachments] = await connection.query(selectQuery, selectParams);
    
    let deleteQuery = 'DELETE FROM appointment WHERE 1=1';
    const deleteParams = [];
    if (Array.isArray(ids) && ids.length) { deleteQuery += ' AND id IN (?)'; deleteParams.push(ids); }
    if (fromDate) { deleteQuery += ' AND DateSigned >= ?'; deleteParams.push(parseDMYtoYMD(fromDate)); }
    if (toDate) { deleteQuery += ' AND DateSigned <= ?'; deleteParams.push(parseDMYtoYMD(toDate)); }
    
    const [result] = await connection.query(deleteQuery, deleteParams);
    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'No matching appointments found' });
    }
    
    for (const attachment of attachments) {
      if (attachment.pdfPath) {
        try {
          fs.unlinkSync(path.join(__dirname, 'Uploads', attachment.pdfPath.replace('/uploads/', '')));
        } catch (unlinkErr) {
          console.warn('Warning: Failed to delete attachment:', unlinkErr.message);
        }
      }
    }
    await connection.commit();
    // Invalidate cache for all graph types
    ['year', 'month', 'week', 'date'].forEach(invalidateAllCacheForType);
    res.json({ message: `${result.affectedRows} appointments deleted` });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error deleting appointments:', err);
    res.status(500).json({ error: 'Failed to delete appointments', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// BULK upload appointments (unchanged, no cache invalidation needed on insert)
app.post('/appointments/bulk', async (req, res) => {
  const { appointments } = req.body;
  if (!Array.isArray(appointments) || !appointments.length) {
    return res.status(400).json({ error: 'No data provided' });
  }

  const invalid = appointments.filter((a) => !validateAppointment(a, false));
  if (invalid.length > 0) {
    return res.status(400).json({
      error: 'Some entries are missing required fields',
      details: invalid.map((e, i) => `Row ${i + 1}: ${JSON.stringify(e)}`).join('\n'),
    });
  }

  const values = appointments.map((a) => [
    a.name,
    a.positionTitle,
    a.statusAppointment,
    a.schoolOffice,
    a.natureAppointment || '',
    a.itemNo || '',
    parseDMYtoYMD(a.DateSigned),
    null // pdfPath is null for bulk upload
  ]);

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const query = `
      INSERT INTO appointment (name, positionTitle, statusAppointment, schoolOffice, natureAppointment, itemNo, DateSigned, pdfPath)
      VALUES ?`;
    const [result] = await connection.query(query, [values]);
    await connection.commit();
    // Invalidate cache for all graph types since bulk insert affects all aggregations
    ['year', 'month', 'week', 'date'].forEach(invalidateAllCacheForType);
    res.status(201).json({ message: `${result.affectedRows} appointments inserted successfully` });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error bulk inserting appointments:', err);
    res.status(500).json({ error: 'Bulk insert failed', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// Upload PDF attachment for an appointment
app.post('/appointments/:id/attachment', upload.single('attachment'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const attachmentPath = `/uploads/${req.file.filename}`;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT pdfPath FROM appointment WHERE id = ?', [id]);
    if (!existing.length) {
      await connection.rollback();
      fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
      return res.status(404).json({ error: 'Appointment not found' });
    }
    const oldAttachmentPath = existing[0].pdfPath;
    const [result] = await connection.query('UPDATE appointment SET pdfPath = ? WHERE id = ?', [attachmentPath, id]);
    if (result.affectedRows === 0) {
      await connection.rollback();
      fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (oldAttachmentPath) {
      try {
        fs.unlinkSync(path.join(__dirname, 'Uploads', oldAttachmentPath.replace('/uploads/', '')));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete old attachment:', unlinkErr.message);
      }
    }
    await connection.commit();
    // Invalidate cache for all graph types since attachment update might affect metadata
    ['year', 'month', 'week', 'date'].forEach(invalidateAllCacheForType);
    res.json({ message: 'File uploaded successfully', path: attachmentPath });
  } catch (err) {
    if (connection) await connection.rollback();
    try {
      fs.unlinkSync(path.join(__dirname, 'Uploads', req.file.filename));
    } catch (unlinkErr) {
      console.warn('Warning: Failed to delete temporary file:', unlinkErr.message);
    }
    console.error('Error uploading attachment:', err);
    res.status(500).json({ error: 'Failed to upload attachment', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET graph data (unchanged)
app.get('/appointments/graph', async (req, res) => {
  const { type, name, statusAppointment, year, month } = req.query;
  if (!['year', 'month', 'week', 'date'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const cacheKey = `${type}-${name || 'all'}-${statusAppointment || 'all'}-${year || 'all'}-${month || 'all'}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);
  const groupFormat = {
    year: { label: 'YEAR(DateSigned)', groupBy: 'YEAR(DateSigned)', orderBy: 'YEAR(DateSigned)' },
    month: { label: "CONCAT(YEAR(DateSigned), '-', LPAD(MONTH(DateSigned), 2, '0'))", groupBy: 'YEAR(DateSigned), MONTH(DateSigned)', orderBy: 'YEAR(DateSigned), MONTH(DateSigned)' },
    week: { label: "CONCAT(YEAR(DateSigned), '-W', LPAD(WEEK(DateSigned), 2, '0'))", groupBy: 'YEAR(DateSigned), WEEK(DateSigned)', orderBy: 'YEAR(DateSigned), WEEK(DateSigned)' },
    date: { label: "DATE_FORMAT(DateSigned, '%Y-%m-%d')", groupBy: 'DATE(DateSigned)', orderBy: 'DATE(DateSigned)' },
  }[type] || { label: 'YEAR(DateSigned)', groupBy: 'YEAR(DateSigned)', orderBy: 'YEAR(DateSigned)' }; // Default to year
  let query = `SELECT ${groupFormat.label} AS label, COUNT(*) AS count FROM appointment WHERE DateSigned IS NOT NULL`;
  const params = [];
  if (name) { query += ' AND name LIKE ?'; params.push(`%${name}%`); }
  if (statusAppointment) { query += ' AND statusAppointment = ?'; params.push(statusAppointment); }
  if (year) { query += ' AND YEAR(DateSigned) = ?'; params.push(year); }
  if (month) { query += ' AND MONTH(DateSigned) = ?'; params.push(month); }
  query += ` GROUP BY ${groupFormat.groupBy} ORDER BY ${groupFormat.orderBy}`;
  try {
    const [results] = await pool.query(query, params);
    const response = results.length
      ? { labels: results.map(r => r.label), datasets: [{ label: `Appointments by ${type}`, data: results.map(r => r.count), backgroundColor: 'rgba(75, 192, 192, 0.6)' }] }
      : { labels: [], datasets: [{ label: `Appointments by ${type}`, data: [], backgroundColor: 'rgba(75, 192, 192, 0.6)' }] };
    setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve graph data', details: err.message });
  }
});

// === Start Server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT} at ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: true })}`);
});