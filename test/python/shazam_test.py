import asyncio
import os
import ssl
import certifi
from shazamio import Shazam

# Create an SSL context using certifi’s certificate bundle
ssl_context = ssl.create_default_context(cafile=certifi.where())

async def main():
    file_path = "audio_sample.ogg"
    if not os.path.exists(file_path):
        print(f"Error: File '{file_path}' does not exist. Please record or download an audio sample and save it in the project folder.")
        return

    shazam = Shazam()
    try:
        result = await shazam.recognize(file_path)
        print(result)
    except Exception as e:
        print("Error recognizing song:", e)

if __name__ == "__main__":
    asyncio.run(main())
