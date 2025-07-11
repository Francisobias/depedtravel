const express = require('express');
const pool = require('../config/db');
const upload = require('../config/multer');
const { parseDMYtoYMD } = require('../utils/date');
const { invalidateCache } = require('../utils/cache');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// === Upload TravelAuthority Excel ===
router.post('/upload', async (req, res) => {
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
router.post('/bulk', async (req, res) => {
  const entries = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'No data provided' });
  }
  const invalidEntries = entries.filter(e => 
    !e.employeeID || !e.positiondesignation || !e.station || !e.purpose || !e.host || !e.fromDate || !e.toDate || !e.destination || !e.area || !e.sof
  );
  if (invalidEntries.length > 0) {
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
    res.status(500).json({ error: 'Failed to insert travel entries', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// === Bulk Update for TravelAuthority ===
router.put('/bulk', upload.array('attachments', 100), async (req, res) => {
  const entries = req.body.entries ? (Array.isArray(req.body.entries) ? req.body.entries : JSON.parse(req.body.entries)) : [];
  const files = req.files || [];
  if (!entries.length) {
    files.forEach(file => fs.unlinkSync(path.join(__dirname, '../Uploads', file.filename)));
    return res.status(400).json({ error: 'No entries provided' });
  }

  // Validate entries
  const requiredFields = ['id', 'employeeID', 'positiondesignation', 'station', 'purpose', 'host', 'datesfrom', 'datesto', 'destination', 'area', 'sof'];
  const invalidEntries = entries.filter(e => 
    requiredFields.some(field => e[field] == null || e[field] === '')
  );
  if (invalidEntries.length) {
    files.forEach(file => fs.unlinkSync(path.join(__dirname, '../Uploads', file.filename)));
    return res.status(400).json({ error: 'All fields are required for each entry', details: invalidEntries });
  }

  // Map files to entry IDs
  const attachmentMap = {};
  files.forEach(file => {
    const entryId = file.originalname.split('-')[0]; // Assuming filename format: {entryId}-filename
    attachmentMap[entryId] = `/uploads/${file.filename}`;
  });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Fetch existing entries to check for old attachments
    const entryIds = entries.map(e => e.id);
    const [existingEntries] = await connection.query('SELECT id, Attachment FROM TravelAuthority WHERE id IN (?)', [entryIds]);
    const existingAttachmentMap = {};
    existingEntries.forEach(entry => {
      existingAttachmentMap[entry.id] = entry.Attachment;
    });

    // Prepare updates
    const updatePromises = entries.map(async (entry) => {
      const { id, employeeID, positiondesignation, station, purpose, host, datesfrom, datesto, destination, area, sof } = entry;
      const attachmentPath = attachmentMap[id] || existingAttachmentMap[id] || null;

      const query = `
        UPDATE TravelAuthority 
        SET employee_ID = ?, PositionDesignation = ?, Station = ?, Purpose = ?, 
            Host = ?, DatesFrom = ?, DatesTo = ?, Destination = ?, Area = ?, sof = ?, Attachment = ?
        WHERE id = ?
      `;
      const params = [
        employeeID, positiondesignation, station, purpose, host, 
        parseDMYtoYMD(datesfrom), parseDMYtoYMD(datesto), destination, area, sof, 
        attachmentPath, id
      ];
      const [result] = await connection.query(query, params);

      // Delete old attachment if replaced
      if (attachmentMap[id] && existingAttachmentMap[id]) {
        try {
          fs.unlinkSync(path.join(__dirname, '../Uploads', existingAttachmentMap[id].replace('/uploads/', '')));
        } catch (unlinkErr) {
          console.warn(`Warning: Failed to delete old attachment for entry ${id}:`, unlinkErr.message);
        }
      }

      return result.affectedRows;
    });

    // Execute all updates
    const results = await Promise.all(updatePromises);
    const updatedCount = results.reduce((sum, affectedRows) => sum + affectedRows, 0);

    if (updatedCount !== entries.length) {
      await connection.rollback();
      files.forEach(file => fs.unlinkSync(path.join(__dirname, '../Uploads', file.filename)));
      return res.status(404).json({ error: 'Some entries were not found' });
    }

    await connection.commit();
    invalidateCache('/travels');
    res.json({ message: `${updatedCount} travel entries updated` });
  } catch (err) {
    if (connection) await connection.rollback();
    files.forEach(file => {
      try {
        fs.unlinkSync(path.join(__dirname, '../Uploads', file.filename));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete temporary file:', unlinkErr.message);
      }
    });
    res.status(500).json({ error: 'Failed to update travel entries', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// === CRUD TravelAuthority with Attachment Support ===
router.get('/', async (req, res) => {
  try {
    const [results] = await pool.query('SELECT * FROM TravelAuthority LEFT JOIN Employee ON Employee.uid = TravelAuthority.employee_ID');
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch travel entries', details: err.message });
  }
});

router.get('/filter', async (req, res) => {
  const { name, initial, fromDate, toDate, sof } = req.query;
  let query = 'SELECT id, Initial, Name, PositionDesignation, Station, Purpose, Host, DATE_FORMAT(DatesFrom, \'%Y-%m-%d\') as DatesFrom, DATE_FORMAT(DatesTo, \'%Y-%m-%d\') as DatesTo, Destination, Area, sof, Attachment FROM TravelAuthority WHERE 1=1';
  const params = [];
  if (name) { query += ' AND Name LIKE ?'; params.push(`%${name}%`); }
  if (initial) { query += ' AND Initial = ?'; params.push(initial); }
  if (fromDate) { query += ' AND DatesFrom >= ?'; params.push(fromDate); }
  if (toDate) { query += ' AND DatesTo <= ?'; params.push(toDate); }
  if (sof) { query += ' AND sof LIKE ?'; params.push(`%${sof}%`); }
  if (params.length === 0) query += ' LIMIT 1000';
  query += ' ORDER BY DatesFrom DESC';
  try {
    const [results] = await pool.query(query, params);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch filtered travel entries', details: err.message });
  }
});

router.post('/', upload.single('attachment'), async (req, res) => {
  const { employeeID, positiondesignation, station, purpose, host, datesfrom, datesto, destination, area, sof } = req.body;
  if (!employeeID || !positiondesignation || !station || !purpose || !host || !datesfrom || !datesto || !destination || !area || !sof) {
    if (req.file) fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
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
    if (req.file) fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
    res.status(500).json({ error: 'Failed to insert travel entry', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

router.put('/:id', upload.single('attachment'), async (req, res) => {
  const { id } = req.params;
  const { employeeID, positiondesignation, station, purpose, host, datesfrom, datesto, destination, area, sof } = req.body;
  if (!employeeID || !positiondesignation || !station || !purpose || !host || !datesfrom || !datesto || !destination || !area || !sof) {
    if (req.file) fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
    return res.status(400).json({ error: 'All fields are required', details: 'Missing one or more required fields' });
  }
  const attachmentPath = req.file ? `/uploads/${req.file.filename}` : undefined;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT Attachment FROM TravelAuthority WHERE id = ?', [id]);
    if (!existing.length) {
      if (req.file) fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
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
      if (req.file) fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
      return res.status(404).json({ error: 'Travel entry not found' });
    }
    if (req.file && oldAttachmentPath) {
      try {
        fs.unlinkSync(path.join(__dirname, '../Uploads', oldAttachmentPath.replace('/uploads/', '')));
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
        fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete temporary file:', unlinkErr.message);
      }
    }
    res.status(500).json({ error: 'Failed to update travel entry', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

router.delete('/:id', async (req, res) => {
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
        fs.unlinkSync(path.join(__dirname, '../Uploads', attachmentPath.replace('/uploads/', '')));
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

router.post('/delete', async (req, res) => {
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

router.get('/graph', async (req, res) => {
  const { type, employee_ID, year, month, positionTitle } = req.query;
  if (!['year', 'month', 'week', 'date'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const employeeIdFilter = employee_ID ? parseInt(employee_ID) : null;
  if (employee_ID && isNaN(employeeIdFilter)) return res.status(400).json({ error: 'Invalid employee ID' });
  const cacheKey = `${type}-${employeeIdFilter || 'all'}-${year || 'all'}-${month || 'all'}-${positionTitle || 'all'}`;
  const cached = require('../utils/cache').getCache(cacheKey);
  if (cached) return res.json(cached);
  const groupFormat = {
    year: { label: 'YEAR(DatesFrom)', groupBy: 'YEAR(DatesFrom)', orderBy: 'YEAR(DatesFrom)' },
    month: { label: "CONCAT(YEAR(DatesFrom), '-', LPAD(MONTH(DatesFrom), 2, '0'))", groupBy: 'YEAR(DatesFrom), MONTH(DatesFrom)', orderBy: 'YEAR(DatesFrom), MONTH(DatesFrom)' },
    week: { label: "CONCAT(YEAR(DatesFrom), '-W', LPAD(WEEK(DatesFrom), 2, '0'))", groupBy: 'YEAR(DatesFrom), WEEK(DatesFrom)', orderBy: 'YEAR(DatesFrom), WEEK(DatesFrom)' },
    date: { label: "DATE_FORMAT(DatesFrom, '%Y-%m-%d')", groupBy: 'DATE(DatesFrom)', orderBy: 'DATE(DatesFrom)' },
  }[type] || { label: 'YEAR(DatesFrom)', groupBy: 'YEAR(DatesFrom)', orderBy: 'YEAR(DatesFrom)' };
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
    require('../utils/cache').setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve graph data', details: err.message });
  }
});

module.exports = router;