const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true
  },
  picture: {
    type: String,
    default: ''
  },
  givenName: {
    type: String,
    default: ''
  },
  familyName: {
    type: String,
    default: ''
  },
  plan: {
    type: String,
    enum: ['free', 'premium', 'enterprise'],
    default: 'free'
  },
  totalTokensUsed: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema);
