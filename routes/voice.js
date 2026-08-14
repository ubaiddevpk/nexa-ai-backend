const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Configure multer file upload middleware inside temporary disk storage for transcription
const upload = multer({ dest: 'uploads/' });

// 1. Voice-to-Text Transcription via Gemini (multimodal audio parsing)
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  let tempFilePath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    tempFilePath = req.file.path;

    // Read the recorded audio file buffer and convert to base64
    const audioBuffer = fs.readFileSync(tempFilePath);
    const base64Audio = audioBuffer.toString('base64');

    console.log('Sending audio to Gemini for transcription...');
    
    // Call Gemini with the audio data and a prompt to transcribe it
    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: [
        {
          inlineData: {
            mimeType: req.file.mimetype || 'audio/webm',
            data: base64Audio
          }
        },
        { text: 'Please transcribe this audio recording into clear text. Do not add any introductory or concluding comments. Just output the transcribed text.' }
      ]
    });

    const transcribedText = response.text || '';
    console.log(`Transcribed text: "${transcribedText}"`);
    res.json({ text: transcribedText });
  } catch (error) {
    console.error('Transcription failed:', error);
    res.status(500).json({ error: error.message });
  } finally {
    // Delete the temporary file if it was created
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        console.error('Failed to delete temp file:', err);
      }
    }
  }
});

// 2. Text-to-Voice Speech synthesis (using Web Speech API on the client side is recommended for Free Tier, 
//    but we keep this stub or fallback intact)
router.post('/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text input parameter is required' });
    }
    // We notify that for Free Tier, speech is best handled on client browser (already done)
    res.status(501).json({ error: 'TTS API not supported on free-tier Gemini API key. Client-side browser synthesis is active.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
