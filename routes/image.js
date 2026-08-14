const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Generate Image via Gemini (gemini-2.5-flash-image)
router.post('/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt content is required' });
    }

    console.log(`Generating image for prompt: "${prompt}"...`);
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: prompt,
      config: { responseModalities: ['IMAGE', 'TEXT'] }
    });

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64Bytes = part.inlineData.data;
          const mimeType = part.inlineData.mimeType || 'image/jpeg';
          return res.json({ imageUrl: `data:${mimeType};base64,${base64Bytes}` });
        }
      }
    }

    res.status(500).json({ error: 'No image was returned by the model.' });
  } catch (error) {
    console.error('Error generating image:', error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
});

module.exports = router;
