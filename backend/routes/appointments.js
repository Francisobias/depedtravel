const express = require('express');
const pool = require('../config/db');
const upload = require('../config/multer');
const { parseDMYtoYMD } = require('../utils/date');
const { invalidateCache } = require('../utils/cache');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const validateAppointment = (a, checkAll = true) => {
  return (
    a.name && a.positionTitle && a.statusAppointment &&
    a.schoolOffice && a.DateSigned &&
    (!checkAll || a.natureAppointment !== undefined)
  );
};

router.get('/', async (req, res) => {
  try {
    const [results] = await pool.query('SELECT * FROM appointment');
    res.json(results);
  } catch (err) {
    console.error('Error fetching appointments:', err);
    res.status(500).json({ error: 'Failed to fetch appointments', details: err.message });
  }
});

router.post('/', upload.single('attachment'), async (req, res) => {
  const { name, positionTitle, statusAppointment, schoolOffice, natureAppointment = '', itemNo = '', DateSigned } = req.body;
  if (!validateAppointment(req.body, false)) {
    if (req.file) fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
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
    ['year', 'month', 'week', 'date'].forEach(type => invalidateCache(`${type}-`));
    res.status(201).json({ id: result.insertId, pdfPath: attachmentPath });
  } catch (err) {
    if (connection) await connection.rollback();
    if (req.file) fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
    console.error('Error inserting appointment:', err);
    res.status(500).json({ error: 'Failed to insert appointment', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

router.put('/:id', upload.single('attachment'), async (req, res) => {
  const { id } = req.params;
  const { name, positionTitle, statusAppointment, schoolOffice, natureAppointment = '', itemNo = '', DateSigned } = req.body;
  if (!validateAppointment(req.body)) {
    if (req.file) fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const attachmentPath = req.file ? `/uploads/${req.file.filename}` : undefined;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT pdfPath FROM appointment WHERE id = ?', [id]);
    if (!existing.length) {
      if (req.file) fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
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
      if (req.file) fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (req.file && oldAttachmentPath) {
      try {
        fs.unlinkSync(path.join(__dirname, '../Uploads', oldAttachmentPath.replace('/uploads/', '')));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete old attachment:', unlinkErr.message);
      }
    }
    await connection.commit();
    ['year', 'month', 'week', 'date'].forEach(type => invalidateCache(`${type}-`));
    res.json({ message: 'Appointment updated', pdfPath: attachmentPath || oldAttachmentPath });
  } catch (err) {
    if (connection) await connection.rollback();
    if (req.file) {
      try {
        fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
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

router.delete('/:id', async (req, res) => {
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
        fs.unlinkSync(path.join(__dirname, '../Uploads', attachmentPath.replace('/uploads/', '')));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete attachment:', unlinkErr.message);
      }
    }
    await connection.commit();
    ['year', 'month', 'week', 'date'].forEach(type => invalidateCache(`${type}-`));
    res.json({ message: 'Appointment deleted' });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error deleting appointment:', err);
    res.status(500).json({ error: 'Failed to delete appointment', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

router.post('/delete', async (req, res) => {
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
          fs.unlinkSync(path.join(__dirname, '../Uploads', attachment.pdfPath.replace('/uploads/', '')));
        } catch (unlinkErr) {
          console.warn('Warning: Failed to delete attachment:', unlinkErr.message);
        }
      }
    }
    await connection.commit();
    ['year', 'month', 'week', 'date'].forEach(type => invalidateCache(`${type}-`));
    res.json({ message: `${result.affectedRows} appointments deleted` });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error deleting appointments:', err);
    res.status(500).json({ error: 'Failed to delete appointments', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

router.post('/bulk', async (req, res) => {
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
    null
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
    ['year', 'month', 'week', 'date'].forEach(type => invalidateCache(`${type}-`));
    res.status(201).json({ message: `${result.affectedRows} appointments inserted successfully` });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error bulk inserting appointments:', err);
    res.status(500).json({ error: 'Bulk insert failed', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

router.post('/:id/attachment', upload.single('attachment'), async (req, res) => {
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
      fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
      return res.status(404).json({ error: 'Appointment not found' });
    }
    const oldAttachmentPath = existing[0].pdfPath;
    const [result] = await connection.query('UPDATE appointment SET pdfPath = ? WHERE id = ?', [attachmentPath, id]);
    if (result.affectedRows === 0) {
      await connection.rollback();
      fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (oldAttachmentPath) {
      try {
        fs.unlinkSync(path.join(__dirname, '../Uploads', oldAttachmentPath.replace('/uploads/', '')));
      } catch (unlinkErr) {
        console.warn('Warning: Failed to delete old attachment:', unlinkErr.message);
      }
    }
    await connection.commit();
    ['year', 'month', 'week', 'date'].forEach(type => invalidateCache(`${type}-`));
    res.json({ message: 'File uploaded successfully', path: attachmentPath });
  } catch (err) {
    if (connection) await connection.rollback();
    try {
      fs.unlinkSync(path.join(__dirname, '../Uploads', req.file.filename));
    } catch (unlinkErr) {
      console.warn('Warning: Failed to delete temporary file:', unlinkErr.message);
    }
    console.error('Error uploading attachment:', err);
    res.status(500).json({ error: 'Failed to upload attachment', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

router.get('/graph', async (req, res) => {
  const { type, name, statusAppointment, year, month } = req.query;
  if (!['year', 'month', 'week', 'date'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const cacheKey = `${type}-${name || 'all'}-${statusAppointment || 'all'}-${year || 'all'}-${month || 'all'}`;
  const cached = require('../utils/cache').getCache(cacheKey);
  if (cached) return res.json(cached);
  const groupFormat = {
    year: { label: 'YEAR(DateSigned)', groupBy: 'YEAR(DateSigned)', orderBy: 'YEAR(DateSigned)' },
    month: { label: "CONCAT(YEAR(DateSigned), '-', LPAD(MONTH(DateSigned), 2, '0'))", groupBy: 'YEAR(DateSigned), MONTH(DateSigned)', orderBy: 'YEAR(DateSigned), MONTH(DateSigned)' },
    week: { label: "CONCAT(YEAR(DateSigned), '-W', LPAD(WEEK(DateSigned), 2, '0'))", groupBy: 'YEAR(DateSigned), WEEK(DateSigned)', orderBy: 'YEAR(DateSigned), WEEK(DateSigned)' },
    date: { label: "DATE_FORMAT(DateSigned, '%Y-%m-%d')", groupBy: 'DATE(DateSigned)', orderBy: 'DATE(DateSigned)' },
  }[type] || { label: 'YEAR(DateSigned)', groupBy: 'YEAR(DateSigned)', orderBy: 'YEAR(DateSigned)' };
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
    require('../utils/cache').setCache(cacheKey, response);
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve graph data', details: err.message });
  }
});

module.exports = router;