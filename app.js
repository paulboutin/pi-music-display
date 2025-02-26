// app.js
import express from 'express';
import multer from 'multer';
import axios from 'axios';
import { simulateRecording } from './micController.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const FormData = require('form-data'); // Use CommonJS require for form-data

const app = express();

app.use(express.static('public'));

// Set EJS as the view engine and define the views directory
app.set('view engine', 'ejs');
app.set('views', './views');

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
    const response = await axios.post('http://python:8000/recognize', formData, {
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

// Status route: returns current status and track information
app.get('/status', (req, res) => {
  res.json({
    status: app.locals.status || 'idle',
    track: app.locals.track || null
  });
});

// Route to toggle pause state:
app.post('/togglePause', (req, res) => {
  if (app.locals.status === STATES.PAUSED) {
    app.locals.status = STATES.IDLE; // or resume your normal state
  } else {
    app.locals.status = STATES.PAUSED;
  }
  res.json({ status: app.locals.status });
});

// Used for testing the API service and the Template without a Mic
// To use it navigate to http://localhost:3000/simulate-voice to trigger the event
// your .env file must have SIMULATE_API=false for the test to work
// Simulated voice route: use a test audio file instead of live recording
app.get('/simulate-voice', async (req, res) => {
  try {
    const result = await simulateRecording(req.app);
    res.json({ message: 'Simulated voice event processed.', track: result.track });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Root route: renders the EJS template for the display
app.get('/', (req, res) => {
  res.render('index', { 
    status: app.locals.status || 'idle', 
    track: app.locals.track || null 
  });
});

export default app;
