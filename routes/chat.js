

const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const User = require('../models/User');
const { GoogleGenAI } = require('@google/genai');
const multer = require('multer');

// Use pdfjs-dist for reliable PDF text extraction on Node.js 22+
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

async function extractPdfText(buffer) {
  const uint8Array = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
  const pdf = await loadingTask.promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return { text: fullText, numpages: pdf.numPages };
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Configure multer storage in memory for handling PDF files
const upload = multer({ storage: multer.memoryStorage() });

// Optional auth helper to check if token exists without forcing 401
const jwt = require('jsonwebtoken');
function extractUserId(req) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const secret = process.env.JWT_SECRET || 'nexa_ai_jwt_default_secret_key';
      const decoded = jwt.verify(token, secret);
      return decoded.userId;
    }
  } catch (e) {
    // Ignore invalid token and treat as guest/all
  }
  return null;
}

// 1. Get all chats (both active and archived)
router.get('/', async (req, res) => {
  try {
    const userId = extractUserId(req);
    const filter = userId ? { userId } : {};
    const chats = await Chat.find(filter).sort({ createdAt: -1 });
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Create a new chat session
router.post('/', async (req, res) => {
  try {
    const userId = extractUserId(req);
    const newChat = new Chat({
      title: req.body.title || 'New Chat Session',
      userId: userId || null,
      archived: false,
      messages: []
    });
    const savedChat = await newChat.save();
    res.status(201).json(savedChat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Update chat session properties (archive status, title)
router.put('/:id', async (req, res) => {
  try {
    const { title, archived, activePDF } = req.body;
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (archived !== undefined) updateData.archived = archived;
    if (activePDF !== undefined) updateData.activePDF = activePDF;

    // If activePDF is set to null, clean corresponding text content too
    if (activePDF === null) {
      updateData.activePDF = null;
      updateData.pdfContent = null;
    }

    const updatedChat = await Chat.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    );
    if (!updatedChat) return res.status(404).json({ error: 'Chat not found' });
    res.json(updatedChat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Delete a chat session permanently
router.delete('/:id', async (req, res) => {
  try {
    const deletedChat = await Chat.findByIdAndDelete(req.params.id);
    if (!deletedChat) return res.status(404).json({ error: 'Chat not found' });
    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Send message & generate AI response with PDF context
router.post('/:id/messages', async (req, res) => {
  try {
    const { content } = req.body;
    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // Save user message to database
    const userMessage = {
      role: 'user',
      content,
      attachedPDF: chat.activePDF
    };
    chat.messages.push(userMessage);

    // If chat title is default, update with the user's first prompt query
    if (chat.title === 'New Chat Session') {
      chat.title = content.length > 30 ? content.substring(0, 30) + '...' : content;
    }

    // Assemble messages payload for Gemini
    const creatorPrompt = "You are NexaAI, an advanced multimodal AI assistant created and built by Obaidullah, a professional Full-Stack Website Developer. If anyone asks who built, developed, created, or designed you, state formally and politely that you were developed by Obaidullah, a skilled Full-Stack Website Developer.";
    
    const systemPrompt = chat.pdfContent
      ? `${creatorPrompt}\n\nThe user has attached a PDF document context titled "${chat.activePDF}". Refer to this extracted document text to answer the user's prompt query accurately:\n\n=== EXTRACTED PDF TEXT ===\n${chat.pdfContent}\n==========================`
      : `${creatorPrompt}\n\nAnswer the user's queries concisely, helpfully, and format output cleanly using Markdown.`;

    // Convert messages to Gemini's format: role must be 'user' or 'model'
    const apiMessages = chat.messages.slice(-15).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Helper to get GoogleGenAI client (using custom user key if provided, else system default)
    const customApiKey = req.headers['x-gemini-api-key'];
    const client = customApiKey
      ? new GoogleGenAI({ apiKey: customApiKey })
      : ai;

    // Generate assistant completion via Gemini
    const response = await client.models.generateContent({
      model: 'gemini-flash-latest',
      contents: apiMessages,
      config: {
        systemInstruction: systemPrompt
      }
    });

    const assistantContent = response.text;

    // Extract real token usage from Gemini response
    const tokensUsed = response.usageMetadata?.totalTokenCount || 0;

    // If user is authenticated, increment their totalTokensUsed in MongoDB
    const userId = extractUserId(req) || chat.userId;
    if (userId && tokensUsed > 0) {
      try {
        await User.findByIdAndUpdate(userId, {
          $inc: { totalTokensUsed: tokensUsed }
        });
      } catch (err) {
        console.error('Failed to increment user token count:', err);
      }
    }

    const assistantMessage = {
      role: 'assistant',
      content: assistantContent
    };
    chat.messages.push(assistantMessage);

    await chat.save();
    res.status(200).json(chat);
  } catch (error) {
    console.error('Error in /messages route:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Upload PDF attachment, parse text, and store in session context
router.post('/:id/pdf', upload.single('pdf'), async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    console.log(`Parsing PDF: ${req.file.originalname} (${req.file.size} bytes)`);

    // Parse the PDF buffer content into readable text using pdfjs-dist
    const parsedData = await extractPdfText(req.file.buffer);
    console.log(`PDF parsed: ${parsedData.numpages} pages, ${parsedData.text.length} chars extracted`);

    chat.activePDF = req.file.originalname;
    chat.pdfContent = parsedData.text;

    await chat.save();
    res.json({
      activePDF: chat.activePDF,
      message: `PDF attached: ${parsedData.numpages} page(s) parsed successfully`
    });
  } catch (error) {
    console.error('Error in PDF upload route:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;