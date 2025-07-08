const express = require('express');
const { OpenAI } = require('openai');
const router = express.Router();

router.post('/chat', async (req, res) => {
  const { message, appointments } = req.body;
  if (typeof message !== 'string' || message.length > 1000) {
    return res.status(400).json({ error: 'Invalid or too long message' });
  }
  try {
    const client = new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
    });
    const recentAppointments = appointments
      .sort((a, b) => new Date(b.DateSigned) - new Date(a.DateSigned))
      .slice(0, 3)
      .map(app => ({
        name: app.name,
        positionTitle: app.positionTitle,
        statusAppointment: app.statusAppointment,
        schoolOffice: app.schoolOffice,
        DateSigned: app.DateSigned ? new Date(app.DateSigned).toLocaleDateString() : '',
      }));
    const context = `
      You are Grok, an AI assistant for an Appointment Management app built with React. The app allows users to:
      - Add/edit appointments via a form with fields: name, position title, status (Scheduled, Confirmed, Completed), school office, nature, item number, date signed, optional PDF.
      - Search appointments by name, position, status, office, nature, item number, or date using a unified search bar.
      - Upload Excel files with columns: name, positionTitle, statusAppointment, schoolOffice, DateSigned.
      - Delete single or multiple appointments with SweetAlert2 confirmation dialogs.
      - View a bar chart of appointments by year.
      Recent appointments: ${JSON.stringify(recentAppointments)}.
      Respond in a natural, human-like way, focusing on how to use the app. For unrelated questions, politely redirect to app features.
    `;
    const response = await client.chat.completions.create({
      model: 'grok-beta',
      messages: [
        { role: 'system', content: context },
        { role: 'user', content: message },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });
    res.json({ response: response.choices[0].message.content });
  } catch (error) {
    console.error('Grok API error:', error);
    res.status(500).json({ error: 'Failed to get response from Grok' });
  }
});

module.exports = router;