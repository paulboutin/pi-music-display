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
let clearTrackTimer = null;
const gapDuration = 5000; // 5 seconds gap duration
const clearTrackDuration = 300000; // 5 minutes in milliseconds
const sampleRate = 16000; // in Hz
let isRecording = false;

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
    // Record for 5 seconds, then stop.
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

// Simulated API call (for testing)
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

// recordAndProcess: Handles recording, amplification, and API matching.
async function recordAndProcess(app) {
  if (isRecording) {
    console.log('Already recording, skipping.');
    return;
  }
  isRecording = true;
  updateAppStatus(app, STATES.RECORDING);
  try {
    const audioFilePath = await recordAudioClip();
    console.log(`Recorded file: ${audioFilePath}, size: ${fs.statSync(audioFilePath).size} bytes`);

    // Amplify the recording using sox; adjust volume factor as needed.
    const amplifiedFilePath = path.join(process.cwd(), 'amplified.ogg');
    console.log("Amplifying the recorded audio...");
    execSync(`sox ${audioFilePath} ${amplifiedFilePath} vol 12`, { stdio: 'inherit' });
    console.log(`Amplified file: ${amplifiedFilePath}, size: ${fs.statSync(amplifiedFilePath).size} bytes`);

    const result = await callShazamAPI(amplifiedFilePath);

    // Clean up temporary files.
    fs.unlink(audioFilePath, (err) => { if (err) console.error('Error deleting file:', err); });
    fs.unlink(amplifiedFilePath, (err) => { if (err) console.error('Error deleting file:', err); });

    if (result && result.track) {
      if (app.locals.track && app.locals.track.id === result.track.id) {
        console.log('Same track matched; maintaining current match.');
        updateAppStatus(app, STATES.MATCHED); // Don't pass the updated track info but update the status to Matched
      } else {
        console.log('New track matched:', result.track.title);
        updateAppStatus(app, STATES.MATCHED, result.track);
        app.locals.track = result.track;
      }
    } else {
      console.log('No match found, remaining idle.');
      updateAppStatus(app, STATES.IDLE);
    }
  } catch (error) {
    console.error('Error during recording and processing:', error);
    updateAppStatus(app, STATES.IDLE);
  } finally {
    isRecording = false;
  }
}

// processAudioData: Processes each audio chunk using a single reused VAD instance.
function processAudioData(audioChunk, app, vadInstance) {
  vadInstance.processAudio(audioChunk, sampleRate)
    .then((result) => {
      if (result !== VAD.Event.VOICE) {
        // No voice detected.
        if (!gapTimer) {
          gapTimer = setTimeout(() => {
            console.log('Gap detected.');
            updateAppStatus(app, STATES.IDLE);
            // If there's an existing track, start a clearTrackTimer to clear it after 5 minutes.
            if (app.locals.track) {
              if (!clearTrackTimer) {
                clearTrackTimer = setTimeout(() => {
                  console.log('5 minutes of silence or no new song matched, clearing track info.');
                  app.locals.track = null;
                  clearTrackTimer = null;
                }, clearTrackDuration);
              }
            }
            gapTimer = null;
          }, gapDuration);
        }
      } else {
        // Sound is detected.
        if (gapTimer) {
          clearTimeout(gapTimer);
          gapTimer = null;
        }
        // If a clearTrackTimer is running (waiting to clear the old track), cancel it.
        if (clearTrackTimer) {
          clearTimeout(clearTrackTimer);
          clearTrackTimer = null;
        }
        // If we are idle, trigger a new recording.
        if (currentState === STATES.IDLE) {
          console.log('Sound resumed after gap. Starting new recording...');
          recordAndProcess(app);
        }
      }
    })
    .catch((err) => {
      console.error('VAD processing error:', err);
    });
}

// startListening: Initializes the continuous microphone stream and calls processAudioData for each chunk.
function startListening(app) {
  if (app && app.locals) {
    app.locals.status = currentState;
    app.locals.track = null;
  }

  // Create a single VAD instance to be reused.
  const vadInstance = new VAD(VAD.Mode.NORMAL);

  const micStream = recorder.record({
    sampleRateHertz: sampleRate,
    threshold: 0,
    verbose: false,
    recordProgram: 'sox',
    device: 'plughw:2,0'
  }).stream();

  micStream.on('data', (data) => {
    processAudioData(data, app, vadInstance);
  });

  micStream.on('error', (err) => {
    console.error('Microphone stream error:', err);
  });
}

export { startListening, recordAndProcess, simulateRecording, STATES };
