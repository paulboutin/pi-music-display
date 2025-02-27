// micController.js
import { createRequire } from 'module';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
const FormData = require('form-data');
const recorder = require('node-record-lpcm16');
const VAD = require('node-vad');
import fs from 'fs';
import path from 'path';
import axios from 'axios';

const STATES = {
  IDLE: 'idle',
  RECORDING: 'recording',
  MATCHED: 'matched',
  RETRY_WAIT: 'retry_wait',
  GAP_DETECTED: 'gap_detected',
  PAUSED: 'paused'
};

let currentState = STATES.IDLE;
let retryCount = 0;
const MAX_RETRIES = 3;
let gapTimer = null;
const gapDuration = 5000; // 5 seconds of silence to consider a gap
const sampleRate = 16000; // in Hz

// updateAppStatus: update the application status and optionally track info
function updateAppStatus(app, status, track = null) {
  currentState = status;
  if (app && app.locals) {
    app.locals.status = status;
    if (track !== null) {
      app.locals.track = track;
    }
  }
  console.log('Status updated:', status);
}

// recordAudioClip: records for a fixed duration (5 seconds) and saves to a file
function recordAudioClip() {
  return new Promise((resolve, reject) => {
    const filePath = path.join(process.cwd(), 'temp_audio.ogg');
    const fileStream = fs.createWriteStream(filePath);
    console.log('Starting clip recording...');
    const recProc = recorder.record({
      sampleRateHertz: sampleRate,
      threshold: 0,
      verbose: false,
      recordProgram: 'sox',
      device: 'plughw:2,0'
    });
    const micStream = recProc.stream();

    if (!micStream || typeof micStream.on !== 'function') {
      console.error('Expected micStream to be a stream, but got:', micStream);
      return reject(new Error('Invalid microphone stream'));
    }

    micStream.pipe(fileStream);

    // Record for 5 seconds, then stop
    setTimeout(() => {
      recProc.stop();
      console.log('Recording finished:', filePath);
      resolve(filePath);
    }, 5000);
  });
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

// Simulated API call for testing
function callShazamAPISimulated(audioFilePath) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        track: {
          id: '1234', // dummy id for testing
          title: 'Love Will Tear Us Apart',
          subtitle: 'Joy Division',
          duration: 180,
          images: {
            coverart: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/76/15/8c/76158ce5-f0c8-f157-d136-a575338406ee/8720996037263.png/400x400cc.jpg'
          }
        }
      });
    }, 1000);
  });
}

// Actual API call to the Python service
function callShazamAPIReal(audioFilePath) {
  const formData = new FormData();
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

// recordAndProcess: Records a clip, amplifies it, sends for recognition, and updates the app status.
async function recordAndProcess(app) {
  // Only trigger recording if we are in IDLE or RETRY_WAIT state.
  if (currentState !== STATES.IDLE && currentState !== STATES.RETRY_WAIT && currentState !== STATES.GAP_DETECTED) {
    console.log('Already recording or processing; skipping.');
    return;
  }
  updateAppStatus(app, STATES.RECORDING);
  try {
    const audioFilePath = await recordAudioClip();
    console.log(`Recorded file: ${audioFilePath}, size: ${fs.statSync(audioFilePath).size} bytes`);

    // Amplify the recording using sox; adjust the volume factor as needed.
    const amplifiedFilePath = path.join(process.cwd(), 'amplified.ogg');
    console.log("Amplifying the recorded audio...");
    execSync(`sox ${audioFilePath} ${amplifiedFilePath} vol 12`, { stdio: 'inherit' });
    console.log(`Amplified file: ${amplifiedFilePath}, size: ${fs.statSync(amplifiedFilePath).size} bytes`);

    // Send the amplified file for song recognition.
    const result = await callShazamAPI(amplifiedFilePath);

    // Clean up temporary files.
    fs.unlink(audioFilePath, (err) => { if (err) console.error('Error deleting file:', err); });
    fs.unlink(amplifiedFilePath, (err) => { if (err) console.error('Error deleting file:', err); });

    if (result && result.track) {
      // If the matched song is the same as the current track, wait a short time and retry.
      if (app.locals.track && app.locals.track.id === result.track.id) {
        console.log('Same track matched, retrying soon...');
        setTimeout(() => {
          updateAppStatus(app, STATES.IDLE);
        }, 10000); // 10-second delay before next attempt.
      } else {
        // New track matched; update the display and set a timeout based on track duration.
        updateAppStatus(app, STATES.MATCHED, result.track);
        console.log('New track matched:', result.track.title);
        app.locals.track = result.track;
        const duration = result.track.duration || 180;
        setTimeout(() => {
          updateAppStatus(app, STATES.IDLE);
          app.locals.track = null;
        }, duration * 1000);
      }
    } else {
      // No match found: retry logic.
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        console.log('Max retries reached, reverting display to default.');
        updateAppStatus(app, STATES.IDLE);
        app.locals.track = null;
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

// processAudioData: Called for each incoming audio chunk from the microphone stream.
function processAudioData(audioChunk, app) {
  // Process the chunk with VAD; note: VAD.processAudio returns a Promise.
  VAD.processAudio(audioChunk, sampleRate)
    .then((result) => {
      // If no voice (sound) is detected...
      if (result !== VAD.Event.VOICE) {
        if (!gapTimer) {
          gapTimer = setTimeout(() => {
            console.log('Gap detected.');
            updateAppStatus(app, STATES.GAP_DETECTED);
            gapTimer = null;
          }, gapDuration);
        }
      } else {
        // Sound is present, clear any pending gap timer.
        if (gapTimer) {
          clearTimeout(gapTimer);
          gapTimer = null;
        }
        // If we've previously detected a gap (or if we're idle), start recording a new clip.
        if (currentState === STATES.GAP_DETECTED || currentState === STATES.IDLE) {
          console.log('Sound resumed after gap. Starting recording...');
          updateAppStatus(app, STATES.RECORDING);
          recordAndProcess(app);
        }
      }
    })
    .catch((err) => {
      console.error('VAD processing error:', err);
    });
}

// startListening: Sets up the continuous microphone stream and calls processAudioData on each chunk.
function startListening(app) {
  if (app && app.locals) {
    app.locals.status = currentState;
    app.locals.track = null;
  }

  // Start a continuous microphone stream for VAD analysis.
  const micStream = recorder.record({
    sampleRateHertz: sampleRate,
    threshold: 0,
    verbose: false,
    recordProgram: 'sox',
    device: 'plughw:2,0'
  }).stream();

  micStream.on('data', (data) => {
    processAudioData(data, app);
  });

  micStream.on('error', (err) => {
    console.error('Microphone stream error:', err);
  });
}

export { startListening, recordAndProcess, simulateRecording, STATES };
