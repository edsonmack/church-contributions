const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const prisma = require('../db');
const { jwtSecret, jwtExpiresIn, allowSignup } = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const ORG_TYPES = ['CHURCH', 'WEDDING', 'FUNERAL', 'SENDOFF', 'OTHER'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Used so a login for an unknown email takes as long as one for a real email.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

function signToken(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: jwtExpiresIn });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organisationId: user.organisationId,
  };
}

// Create a new organisation together with its first user (the OWNER).
router.post('/signup', limiter, async (req, res, next) => {
  try {
    if (!allowSignup) {
      return res.status(403).json({ error: 'Sign-up is closed for now' });
    }

    const body = req.body || {};
    const organisationName = clean(body.organisationName);
    const organisationType = clean(body.organisationType).toUpperCase() || 'OTHER';
    const name = clean(body.name);
    const email = clean(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';

    const errors = [];
    if (!organisationName) errors.push('Organisation name is required');
    if (!ORG_TYPES.includes(organisationType)) {
      errors.push(`Organisation type must be one of: ${ORG_TYPES.join(', ')}`);
    }
    if (!name) errors.push('Your name is required');
    if (!EMAIL_RE.test(email)) errors.push('A valid email is required');
    if (password.length < 8 || password.length > 72) {
      errors.push('Password must be between 8 and 72 characters');
    }
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { organisation, user } = await prisma.$transaction(async (tx) => {
      const organisation = await tx.organisation.create({
        data: { name: organisationName, type: organisationType },
      });
      const user = await tx.user.create({
        data: { organisationId: organisation.id, name, email, passwordHash, role: 'OWNER' },
      });
      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          userId: user.id,
          action: 'ORGANISATION_CREATED',
          entity: 'Organisation',
          entityId: organisation.id,
          details: { name: organisationName, type: organisationType },
        },
      });
      return { organisation, user };
    });

    res.status(201).json({
      token: signToken(user),
      user: publicUser(user),
      organisation: { id: organisation.id, name: organisation.name, type: organisation.type },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', limiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = clean(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';

    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
    const passwordOk = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

    if (!user || !passwordOk || !user.active) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// Who am I? Used by the frontend to restore a session.
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const organisation = await prisma.organisation.findUnique({
      where: { id: req.user.organisationId },
      select: { id: true, name: true, type: true },
    });
    res.json({ user: req.user, organisation });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
