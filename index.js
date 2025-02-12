// index.js
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import fs from 'fs';
import app from './app.js';
import { startListening } from './micController.js';

const PORT = process.env.PORT || 3000;

if (import.meta.url === process.argv[1] || process.argv[1].endsWith('index.js')) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
  // Pass the Express app to the mic controller so that it can update app.locals
  startListening(app);
}

// Configure multer for file uploads (store files in memory for simplicity)
const upload = multer({ storage: multer.memoryStorage() });

// This endpoint receives an audio file and forwards it to the Python API
app.post('/api/recognize', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided.' });
  }

  try {
    // Create form data to send to the Python service
    const formData = new FormData();
    formData.append('audio', req.file.buffer, req.file.originalname);

    // Call the Python API (adjust the URL and port if necessary)
    const response = await axios.post('http://localhost:8000/recognize', formData, {
      headers: {
        ...formData.getHeaders()
      }
    });

    // Send back the API response to the client
    res.json(response.data);
  } catch (error) {
    console.error('Error calling Python API:', error);
    res.status(500).json({ error: 'Error processing audio file.' });
  }
});

// Example GET endpoint to check your Express server is running
app.get('/', (req, res) => {
  res.send('Node.js server is running and ready to proxy audio recognition requests.');
});
