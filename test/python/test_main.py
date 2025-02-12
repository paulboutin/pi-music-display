# test_main.py
import os
import asyncio
import pytest
from fastapi.testclient import TestClient
from main import app  # assuming your FastAPI app is in main.py

client = TestClient(app)

def test_recognize_audio():
    # Ensure a sample audio file exists for testing.
    test_audio_file = "./test/audio_sample.ogg"
    if not os.path.exists(test_audio_file):
        pytest.skip("No test audio file available.")

    with open(test_audio_file, "rb") as f:
        files = {"audio": (test_audio_file, f, "audio/ogg")}
        response = client.post("/recognize", files=files)
    
    assert response.status_code == 200
    json_data = response.json()
    assert "track" in json_data  # Check that the response has the 'track' key

if __name__ == "__main__":
    pytest.main()
