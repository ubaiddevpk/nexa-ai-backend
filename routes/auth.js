const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Helper to generate JWT for a user
 */
function generateToken(user) {
  const secret = process.env.JWT_SECRET || 'nexa_ai_jwt_default_secret_key';
  return jwt.sign(
    {
      userId: user._id,
      googleId: user.googleId,
      email: user.email,
      name: user.name,
      picture: user.picture
    },
    secret,
    { expiresIn: '7d' }
  );
}

/**
 * POST /api/auth/google
 * Verify Google ID Token (from Google Sign In button / One Tap)
 * Body: { credential }
 */
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google credential (ID token) is required' });
    }

    // Verify token with Google OAuth client
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'Invalid Google token payload' });
    }

    const {
      sub: googleId,
      email,
      name,
      picture,
      given_name: givenName,
      family_name: familyName
    } = payload;

    // Find or create user in database
    let user = await User.findOne({
      $or: [{ googleId }, { email: email.toLowerCase() }]
    });

    if (!user) {
      user = new User({
        googleId,
        email: email.toLowerCase(),
        name: name || 'Google User',
        picture: picture || '',
        givenName: givenName || '',
        familyName: familyName || ''
      });
      await user.save();
    } else {
      // Update Google ID / profile details if needed
      user.googleId = googleId;
      if (name) user.name = name;
      if (picture) user.picture = picture;
      await user.save();
    }

    const token = generateToken(user);

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        plan: user.plan,
        totalTokensUsed: user.totalTokensUsed || 0,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Google Auth Error:', error);
    return res.status(401).json({
      error: 'Google authentication failed',
      details: error.message
    });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user details
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-__v');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        plan: user.plan,
        totalTokensUsed: user.totalTokensUsed || 0,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Fetch user error:', error);
    return res.status(500).json({ error: 'Failed to get user profile' });
  }
});

module.exports = router;
