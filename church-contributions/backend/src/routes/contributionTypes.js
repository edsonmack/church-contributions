const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { clean, parseAmount } = require('../validate');
const { logAudit } = require('../audit');

const router = express.Router();

// Treasurer and assistant can view types. Only the treasurer (OWNER) changes them.
router.use(requireAuth, requireRole('OWNER', 'ASSISTANT'));

const FIELDS = { id: true, name: true, defaultAmount: true, active: true, createdAt: true };

const pickFields = (t) => ({
  id: t.id,
  name: t.name,
  defaultAmount: t.defaultAmount,
  active: t.active,
  createdAt: t.createdAt,
});

// List contribution types. Optional: ?active=true|false
router.get('/', async (req, res, next) => {
  try {
    const where = { organisationId: req.user.organisationId };
    if (req.query.active === 'true') where.active = true;
    if (req.query.active === 'false') where.active = false;

    const types = await prisma.contributionType.findMany({
      where,
      select: FIELDS,
      orderBy: { name: 'asc' },
    });
    res.json({ contributionTypes: types });
  } catch (err) {
    next(err);
  }
});

// Create a type, for example "Monthly fee" with a default of 10000.
router.post('/', requireRole('OWNER'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = clean(body.name);
    const errors = [];
    if (!name || name.length > 100) errors.push('Name is required (up to 100 characters)');

    let defaultAmount = null;
    if (body.defaultAmount !== undefined) {
      const parsed = parseAmount(body.defaultAmount);
      if (!parsed.ok) errors.push('Default amount must be a whole number of shillings, 1 or more');
      else defaultAmount = parsed.value;
    }
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });

    const clash = await prisma.contributionType.findFirst({
      where: { organisationId: req.user.organisationId, name: { equals: name, mode: 'insensitive' } },
    });
    if (clash) {
      return res.status(409).json({ error: 'A contribution type with this name already exists' });
    }

    const type = await prisma.$transaction(async (tx) => {
      const created = await tx.contributionType.create({
        data: { organisationId: req.user.organisationId, name, defaultAmount },
        select: FIELDS,
      });
      await logAudit(tx, req, 'CONTRIBUTION_TYPE_CREATED', 'ContributionType', created.id, {
        name,
        defaultAmount,
      });
      return created;
    });

    res.status(201).json({ contributionType: type });
  } catch (err) {
    next(err);
  }
});

// Rename, change the default amount (or clear it with null), or deactivate / reactivate.
router.patch('/:id', requireRole('OWNER'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const errors = [];
    const data = {};

    if (body.name !== undefined) {
      const name = clean(body.name);
      if (!name || name.length > 100) errors.push('Name is required (up to 100 characters)');
      else data.name = name;
    }
    if (body.defaultAmount !== undefined) {
      const parsed = parseAmount(body.defaultAmount);
      if (!parsed.ok) errors.push('Default amount must be a whole number of shillings, 1 or more');
      else data.defaultAmount = parsed.value;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') errors.push('active must be true or false');
      else data.active = body.active;
    }
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nothing to change' });
    }

    const target = await prisma.contributionType.findFirst({
      where: { id: req.params.id, organisationId: req.user.organisationId },
    });
    if (!target) return res.status(404).json({ error: 'Contribution type not found' });

    if (data.name) {
      const clash = await prisma.contributionType.findFirst({
        where: { organisationId: req.user.organisationId, name: { equals: data.name, mode: 'insensitive' } },
      });
      if (clash && clash.id !== target.id) {
        return res.status(409).json({ error: 'A contribution type with this name already exists' });
      }
    }

    const changes = {};
    Object.keys(data).forEach((key) => {
      if (data[key] !== target[key]) changes[key] = { from: target[key], to: data[key] };
    });
    if (Object.keys(changes).length === 0) {
      return res.json({ contributionType: pickFields(target) });
    }

    const type = await prisma.$transaction(async (tx) => {
      const updated = await tx.contributionType.update({
        where: { id: target.id },
        data,
        select: FIELDS,
      });
      await logAudit(tx, req, 'CONTRIBUTION_TYPE_UPDATED', 'ContributionType', target.id, changes);
      return updated;
    });

    res.json({ contributionType: type });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
