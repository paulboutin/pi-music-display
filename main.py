# main.py
import os
import asyncio
from fastapi import FastAPI, UploadFile, File, HTTPException
from shazamio import Shazam

app = FastAPI()

@app.post("/recognize")
async def recognize_song(audio: UploadFile = File(...)):
    # Validate file type (adjust as needed)
    if not audio.filename.endswith(('.ogg', '.wav', '.mp3')):
        raise HTTPException(status_code=400, detail="Unsupported file type. Use .ogg, .wav, or .mp3")

    # Save the uploaded file temporarily
    temp_file = "temp_audio_file"
    try:
        contents = await audio.read()
        with open(temp_file, "wb") as f:
            f.write(contents)
        
        # Instantiate the Shazam client and recognize the song
        shazam = Shazam()
        result = await shazam.recognize(temp_file)
        
        # Clean up the temporary file
        os.remove(temp_file)
        return result
    except Exception as e:
        # Ensure temporary file is removed in case of error
        if os.path.exists(temp_file):
            os.remove(temp_file)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    # Run the FastAPI app with uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
