// test/api.test.js
import request from 'supertest';
import app from '../app.js';
import * as chai from 'chai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

chai.should();

// Get __dirname in an ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('POST /api/recognize', () => {
  it('should upload an audio file and receive a JSON response containing track data', async () => {
    const sampleFilePath = path.join(__dirname, 'audio_sample.ogg');
    if (!fs.existsSync(sampleFilePath)) {
      throw new Error(`Test audio file not found at ${sampleFilePath}`);
    }
    
    const response = await request(app)
      .post('/api/recognize')
      .attach('audio', sampleFilePath);
    
    // Assert HTTP status
    response.status.should.equal(200);
    
    // Assert that the response body is an object and has the expected properties
    response.body.should.be.an('object');
    response.body.should.have.property('track');
    response.body.track.should.be.an('object');
    
    // Check that track contains title and subtitle as strings
    response.body.track.should.have.property('title').that.is.a('string');
    response.body.track.should.have.property('subtitle').that.is.a('string');
    
    // Check that images exists and contains coverart as a string
    response.body.track.should.have.property('images').that.is.an('object');
    response.body.track.images.should.have.property('coverart').that.is.a('string');
    
    // Optionally, check for other properties if needed
    // e.g., response.body.track.should.have.property('key');
  });
});

describe('GET /status', () => {
  it('should return default status when no song is active', async () => {
    const res = await request(app).get('/status');
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('status', 'idle');
    expect(res.body).to.have.property('track', null);
  });
});

