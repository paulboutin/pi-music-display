// app.js
import express from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';

const app = express();

// Configure multer to store uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

// Define the /api/recognize route
app.post('/api/recognize', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided.' });
  }
  try {
    // Prepare form data for the Python API
    const formData = new FormData();
    formData.append('audio', req.file.buffer, req.file.originalname);

    // Forward the request to your Python FastAPI service
    const response = await axios.post('http://localhost:8000/recognize', formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    // Return the JSON response from the Python API
    res.json(response.data);
  } catch (error) {
    console.error('Error calling Python API:', error);
    res.status(500).json({ error: 'Error processing audio file.' });
  }
});

// status route: returns current status and track information
app.get('/status', (req, res) => {
  res.json({
    status: app.locals.status || 'idle',
    track: app.locals.track || null
  });
});

export default app;
