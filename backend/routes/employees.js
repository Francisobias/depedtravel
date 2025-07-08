const express = require('express');
const pool = require('../config/db');
const { invalidateCache } = require('../utils/cache');
const router = express.Router();

// === CRUD Employee ===
router.get('/', async (req, res) => {
  try {
    const [results] = await pool.query('SELECT * FROM Employee');
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch employees', details: err.message });
  }
});

router.post('/', async (req, res) => {
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

router.delete('/:id', async (req, res) => {
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

router.post('/upload', async (req, res) => {
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

module.exports = router;