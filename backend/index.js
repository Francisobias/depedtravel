require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const employeeRoutes = require('./routes/employees');
const travelRoutes = require('./routes/travels');
const appointmentRoutes = require('./routes/appointments');
const chatRoute = require('./routes/chat');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));

// Routes
app.use('/employees', employeeRoutes);
app.use('/travels', travelRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/api', chatRoute);

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT} at ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: true })}`);
});