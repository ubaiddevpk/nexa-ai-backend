require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware configurations
app.use(cors());
app.use(express.json());

// Ensure uploads/ directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✓ Successfully connected to MongoDB Atlas database'))
  .catch((err) => console.error('✗ Failed to connect to MongoDB:', err.message));

// Import routers
const authRouter = require('./routes/auth');
const chatRouter = require('./routes/chat');
const voiceRouter = require('./routes/voice');
const imageRouter = require('./routes/image');

// Route configurations
app.use('/api/auth', authRouter);
app.use('/api/chats', chatRouter);
app.use('/api/voice', voiceRouter);
app.use('/api/image', imageRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// Start listener server
app.listen(PORT, () => {
  console.log(`✓ NexaAI Express integration server running on port ${PORT}`);
});
