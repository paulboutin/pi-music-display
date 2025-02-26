// micController.js
import { createRequire } from 'module';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
const FormData = require('form-data'); 
const recorder = require('node-record-lpcm16');
const VAD = require('node-vad');
import fs from 'fs';
import path from 'path';

const STATES = {
  IDLE: 'idle',
  RECORDING: 'recording',
  MATCHED: 'matched',
  RETRY_WAIT: 'retry_wait',
  PAUSED: 'paused'  // state for user-paused mode
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

// Add a route to toggle pause state:
app.post('/togglePause', (req, res) => {
  if (app.locals.status === STATES.PAUSED) {
    app.locals.status = STATES.IDLE; // or resume your normal state
  } else {
    app.locals.status = STATES.PAUSED;
  }
  res.json({ status: app.locals.status });
});

function recordAudioClip() {
  return new Promise((resolve, reject) => {
    const filePath = path.join(process.cwd(), 'temp_audio.ogg');
    const fileStream = fs.createWriteStream(filePath);

    console.log('Starting clip recording...');
    const recProc = recorder.record({
      sampleRateHertz: 16000,
      threshold: 0,
      verbose: false,
      recordProgram: 'sox',
      device: 'plughw:2,0'  // specifying the USB audio device
    });
    const micStream = recProc.stream();

    if (!micStream || typeof micStream.on !== 'function') {
      console.error('Expected micStream to be a stream, but got:', micStream);
      return reject(new Error('Invalid microphone stream'));
    }

    micStream.pipe(fileStream);

    // Record for 5 seconds, then stop recording
    setTimeout(() => {
      recProc.stop();
      console.log('Recording finished:', filePath);
      resolve(filePath);
    }, 5000);
  });
}

// Simulated API call (for development/testing)
function callShazamAPISimulated(audioFilePath) {
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

// Actual API call to the Python service
import axios from 'axios';

function callShazamAPIReal(audioFilePath) {
  const formData = new FormData();
  const fs = require('fs');
  formData.append('audio', fs.createReadStream(audioFilePath));
  
  return axios.post('http://python:8000/recognize', formData, {
    headers: formData.getHeaders()
  }).then(response => response.data);
}

function callShazamAPI(audioFilePath) {
  const simulateAPI = process.env.SIMULATE_API === 'true';
  return simulateAPI
    ? callShazamAPISimulated(audioFilePath)
    : callShazamAPIReal(audioFilePath);
}

// simulateRecording uses a test file instead of recording from mic
async function simulateRecording(app) {
  const testAudioFilePath = path.join(process.cwd(), 'test', 'audio_sample2.ogg');
  console.log('Simulating recording using test file:', testAudioFilePath);
  try {
    const result = await callShazamAPIReal(testAudioFilePath);
    if (result && result.track) {
      updateAppStatus(app, STATES.MATCHED);
      if (app && app.locals) {
        app.locals.track = result.track;
      }
      console.log('Simulated song matched:', result.track.title);
    } else {
      updateAppStatus(app, STATES.IDLE);
      if (app && app.locals) {
        app.locals.track = null;
      }
    }
    return result;
  } catch (error) {
    console.error('Error in simulateRecording:', error);
    updateAppStatus(app, STATES.IDLE);
    throw error;
  }
}

async function recordAndProcess(app) {
  // Only trigger if idle or retry_wait
  if (currentState !== STATES.IDLE && currentState !== STATES.RETRY_WAIT) return;

  updateAppStatus(app, STATES.RECORDING);
  try {
    const audioFilePath = await recordAudioClip();
    console.log(`Recorded file: ${audioFilePath}, size: ${fs.statSync(audioFilePath).size} bytes`);

    // Amplify the recording using sox.
    // You can adjust the volume factor (e.g., 12 or 12.3) based on your testing.
    const amplifiedFilePath = path.join(process.cwd(), 'amplified.ogg');
    console.log("Amplifying the recorded audio...");
    execSync(`sox ${audioFilePath} ${amplifiedFilePath} vol 12`, { stdio: 'inherit' });

    console.log(`Amplified file: ${amplifiedFilePath}, size: ${fs.statSync(amplifiedFilePath).size} bytes`);

    // Now send the amplified file for song recognition.
    const result = await callShazamAPI(amplifiedFilePath);

    // Clean up the temporary files if needed.
    fs.unlink(audioFilePath, (err) => { if(err) console.error('Error deleting file:', err); });
    fs.unlink(amplifiedFilePath, (err) => { if(err) console.error('Error deleting file:', err); });

    if (result && result.track) {
      // Check if the recognized song is the same as the current song
      if (app.locals.track && app.locals.track.id === result.track.id) {
        console.log('Same track matched, retrying soon...');
        // Update status if needed, but set a short timeout (e.g., 10 seconds)
        // updateAppStatus(app, STATES.MATCHED);
        setTimeout(() => {
          updateAppStatus(app, STATES.IDLE);
        }, 10000); // 10 seconds
      } else {
        // New track matched; update the display and set a timeout based on the track's duration
        updateAppStatus(app, STATES.MATCHED);
        app.locals.track = result.track;
        console.log('New track matched:', result.track.title);
        const duration = result.track.duration || 180;
        setTimeout(() => {
          updateAppStatus(app, STATES.IDLE);
          app.locals.track = null;
        }, duration * 1000);
      } 
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

function startListening(app) {
  if (app && app.locals) {
    app.locals.status = currentState;
    app.locals.track = null;
  }

  const vad = new VAD(VAD.Mode.NORMAL);

  // Start a continuous microphone stream for VAD analysis
  const micStream = recorder.record({
    sampleRateHertz: 16000,
    threshold: 0,
    verbose: false,
    recordProgram: 'sox',
    device: 'plughw:2,0'  // specifying the USB audio device
  }).stream();

  micStream.on('data', (data) => {
    // Process audio data with VAD
    const vadInstance = new VAD(VAD.Mode.NORMAL);
    vadInstance.processAudio(data, 16000)
      .then((result) => {
        if (result === VAD.Event.VOICE && app.locals.status === 'idle') {
          console.log('Voice detected. Triggering recording and processing...');
          // Call your recording-and-processing function here:
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

export { startListening, recordAndProcess, simulateRecording };