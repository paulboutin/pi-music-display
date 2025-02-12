// micController.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const record = require('node-record-lpcm16');
const VAD = require('node-vad');
import fs from 'fs';
import path from 'path';

const STATES = {
  IDLE: 'idle',
  RECORDING: 'recording',
  MATCHED: 'matched',
  RETRY_WAIT: 'retry_wait'
};

let currentState = STATES.IDLE;
let retryCount = 0;
const MAX_RETRIES = 3;
let songDurationTimer = null;

function updateAppStatus(app, status) {
  currentState = status;
  if (app && app.locals) {
    app.locals.status = status;
  }
  console.log('Status updated:', status);
}

function recordAudioClip() {
  return new Promise((resolve, reject) => {
    const filePath = path.join(process.cwd(), 'temp_audio.ogg');
    const fileStream = fs.createWriteStream(filePath);

    console.log('Starting clip recording...');
    const rec = record.start({
      sampleRateHertz: 16000,
      threshold: 0,         // disable built-in silence detection
      verbose: false,
      recordProgram: 'sox'  // Ensure sox is installed on your system/inside your container
    });

    rec.pipe(fileStream);

    // Record for 5 seconds
    setTimeout(() => {
      record.stop();
      console.log('Recording finished:', filePath);
      resolve(filePath);
    }, 5000);
  });
}

// Simulated API call to Shazam (replace with your actual implementation)
function callShazamAPI(audioFilePath) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        track: {
          title: 'Love Will Tear Us Apart',
          subtitle: 'Joy Division',
          duration: 180, // in seconds
          images: {
            coverart: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/76/15/8c/76158ce5-f0c8-f157-d136-a575338406ee/8720996037263.png/400x400cc.jpg'
          }
        }
      });
    }, 1000);
  });
}

async function recordAndProcess(app) {
  // Only trigger if idle or retry_wait
  if (currentState !== STATES.IDLE && currentState !== STATES.RETRY_WAIT) return;

  updateAppStatus(app, STATES.RECORDING);
  try {
    const audioFilePath = await recordAudioClip();
    const result = await callShazamAPI(audioFilePath);

    // Clean up temporary file
    fs.unlink(audioFilePath, (err) => {
      if (err) console.error('Error deleting file:', err);
    });

    if (result && result.track) {
      updateAppStatus(app, STATES.MATCHED);
      // Update the app locals with the track data
      if (app && app.locals) {
        app.locals.track = result.track;
      }
      console.log('Song matched:', result.track.title);

      // Use the track duration (or default to 180s) to set a timer before resetting to idle
      const duration = result.track.duration || 180;
      songDurationTimer = setTimeout(() => {
        updateAppStatus(app, STATES.IDLE);
        // Optionally clear track data
        if (app && app.locals) {
          app.locals.track = null;
        }
      }, duration * 1000);
    } else {
      // No match found
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        console.log('Max retries reached, reverting display to default.');
        updateAppStatus(app, STATES.IDLE);
        if (app && app.locals) {
          app.locals.track = null;
        }
        retryCount = 0;
      } else {
        console.log('No match, retrying in 3 seconds.');
        updateAppStatus(app, STATES.RETRY_WAIT);
        setTimeout(() => {
          updateAppStatus(app, STATES.IDLE);
        }, 3000);
      }
    }
  } catch (error) {
    console.error('Error during recording and processing:', error);
    updateAppStatus(app, STATES.IDLE);
  }
}

export function startListening(app) {
  // Initialize the Express app status
  if (app && app.locals) {
    app.locals.status = currentState;
    app.locals.track = null;
  }

  const vad = new VAD(VAD.Mode.NORMAL);

  // Start a continuous microphone stream for VAD analysis
  const micStream = record.start({
    sampleRateHertz: 16000,
    threshold: 0,
    verbose: false,
    recordProgram: 'sox'
  });

  micStream.on('data', (data) => {
    vad.processAudio(data, 16000)
      .then((result) => {
        if (result === VAD.Event.VOICE && currentState === STATES.IDLE) {
          console.log('Voice detected. Triggering recording...');
          recordAndProcess(app);
        }
      })
      .catch((err) => {
        console.error('VAD processing error:', err);
      });
  });

  micStream.on('error', (err) => {
    console.error('Microphone stream error:', err);
  });
}
