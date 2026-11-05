const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Only the OWNER (treasurer / organiser) manages who can log in.
router.use(requireAuth, requireRole('OWNER'));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASSIGNABLE_ROLES = ['OWNER', 'ASSISTANT']; // MEMBER is reserved for later
const SAFE_FIELDS = { id: true, name: true, email: true, role: true, active: true, createdAt: true };

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

// List the people who can log in to this organisation.
router.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { organisationId: req.user.organisationId },
      select: SAFE_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// Add someone, for example the assistant treasurer.
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = clean(body.name);
    const email = clean(body.email).toLowerCase();
    const role = clean(body.role).toUpperCase() || 'ASSISTANT';
    const password = typeof body.password === 'string' ? body.password : '';

    const errors = [];
    if (!name) errors.push('Name is required');
    if (!EMAIL_RE.test(email)) errors.push('A valid email is required');
    if (!ASSIGNABLE_ROLES.includes(role)) {
      errors.push(`Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
    }
    if (password.length < 8 || password.length > 72) {
      errors.push('Password must be between 8 and 72 characters');
    }
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { organisationId: req.user.organisationId, name, email, passwordHash, role },
        select: SAFE_FIELDS,
      });
      await tx.auditLog.create({
        data: {
          organisationId: req.user.organisationId,
          userId: req.user.id,
          action: 'USER_CREATED',
          entity: 'User',
          entityId: created.id,
          details: { name, email, role },
        },
      });
      return created;
    });

    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

// Disable or re-enable a login, and/or set a new password (for example when the assistant forgets theirs).
// Nothing is deleted, so history stays intact. Send { active } and/or { password }.
router.patch('/:id', async (req, res, next) => {
  try {
    const { active, password } = req.body || {};
    const hasActive = active !== undefined;
    const hasPassword = password !== undefined;

    if (!hasActive && !hasPassword) {
      return res.status(400).json({ error: 'Send active (true or false) or a new password' });
    }
    if (hasActive && typeof active !== 'boolean') {
      return res.status(400).json({ error: 'active must be true or false' });
    }
    if (hasPassword && (typeof password !== 'string' || password.length < 8 || password.length > 72)) {
      return res.status(400).json({ error: 'Password must be between 8 and 72 characters' });
    }
    if (hasActive && req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot disable your own account' });
    }

    // Filtering by organisationId means you can never touch another organisation's user.
    const target = await prisma.user.findFirst({
      where: { id: req.params.id, organisationId: req.user.organisationId },
    });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const data = {};
    if (hasActive) data.active = active;
    if (hasPassword) data.passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data,
        select: SAFE_FIELDS,
      });
      const entries = [];
      if (hasActive) entries.push(active ? 'USER_ENABLED' : 'USER_DISABLED');
      if (hasPassword) entries.push('USER_PASSWORD_RESET');
      for (const action of entries) {
        await tx.auditLog.create({
          data: {
            organisationId: req.user.organisationId,
            userId: req.user.id,
            action,
            entity: 'User',
            entityId: target.id,
            details: { email: target.email },
          },
        });
      }
      return updated;
    });

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
