const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { clean, normalisePhone } = require('../validate');
const { logAudit } = require('../audit');

const router = express.Router();

// Both the treasurer and the assistant can manage members.
router.use(requireAuth, requireRole('OWNER', 'ASSISTANT'));

const FIELDS = { id: true, name: true, phone: true, active: true, createdAt: true };

// Checks name and phone. With partial = true, fields that were not sent are skipped.
function validateMember(input, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || input.name !== undefined) {
    const name = clean(input.name);
    if (!name || name.length > 100) errors.push('Name is required (up to 100 characters)');
    else data.name = name;
  }

  if (input.phone !== undefined) {
    if (input.phone === null || clean(input.phone) === '') {
      data.phone = null;
    } else {
      const phone = normalisePhone(input.phone);
      if (!phone) errors.push('Phone number is not valid');
      else data.phone = phone;
    }
  }

  return { errors, data };
}

// List members. Optional: ?search=jo  and  ?active=true|false
router.get('/', async (req, res, next) => {
  try {
    const where = { organisationId: req.user.organisationId };
    if (req.query.active === 'true') where.active = true;
    if (req.query.active === 'false') where.active = false;
    const search = clean(req.query.search);
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const members = await prisma.member.findMany({
      where,
      select: FIELDS,
      orderBy: { name: 'asc' },
      take: 1000,
    });
    res.json({ members });
  } catch (err) {
    next(err);
  }
});

// Add one member.
router.post('/', async (req, res, next) => {
  try {
    const { errors, data } = validateMember(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });

    if (data.phone) {
      const clash = await prisma.member.findFirst({
        where: { organisationId: req.user.organisationId, phone: data.phone },
      });
      if (clash) {
        return res.status(409).json({ error: 'A member with this phone number already exists' });
      }
    }

    const member = await prisma.$transaction(async (tx) => {
      const created = await tx.member.create({
        data: { organisationId: req.user.organisationId, name: data.name, phone: data.phone ?? null },
        select: FIELDS,
      });
      await logAudit(tx, req, 'MEMBER_CREATED', 'Member', created.id, {
        name: created.name,
        phone: created.phone,
      });
      return created;
    });

    res.status(201).json({ member });
  } catch (err) {
    next(err);
  }
});

// Add many members at once (for loading the first list). All or nothing.
router.post('/bulk', async (req, res, next) => {
  try {
    const rows = req.body && Array.isArray(req.body.members) ? req.body.members : null;
    if (!rows || rows.length === 0 || rows.length > 500) {
      return res.status(400).json({ error: 'Send a list of 1 to 500 members' });
    }

    const problems = [];
    const valid = [];
    const phonesInList = new Set();

    rows.forEach((row, i) => {
      const { errors, data } = validateMember(row && typeof row === 'object' ? row : {});
      if (errors.length) {
        problems.push(`Row ${i + 1}: ${errors.join(', ')}`);
        return;
      }
      if (data.phone) {
        if (phonesInList.has(data.phone)) {
          problems.push(`Row ${i + 1}: phone number ${data.phone} is repeated in this list`);
          return;
        }
        phonesInList.add(data.phone);
      }
      valid.push({ rowNumber: i + 1, name: data.name, phone: data.phone ?? null });
    });

    if (phonesInList.size) {
      const existing = await prisma.member.findMany({
        where: { organisationId: req.user.organisationId, phone: { in: [...phonesInList] } },
        select: { phone: true },
      });
      const taken = new Set(existing.map((m) => m.phone));
      valid.forEach((v) => {
        if (v.phone && taken.has(v.phone)) {
          problems.push(`Row ${v.rowNumber}: phone number ${v.phone} already belongs to a member`);
        }
      });
    }

    if (problems.length) {
      return res.status(400).json({
        error: 'Nothing was imported. Fix these rows and try again.',
        rows: problems.slice(0, 50),
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.member.createMany({
        data: valid.map((v) => ({
          organisationId: req.user.organisationId,
          name: v.name,
          phone: v.phone,
        })),
      });
      await logAudit(tx, req, 'MEMBERS_IMPORTED', 'Member', 'bulk', { count: valid.length });
    });

    res.status(201).json({ imported: valid.length });
  } catch (err) {
    next(err);
  }
});

// Change a member's name or phone, or deactivate / reactivate them. Nothing is deleted.
router.patch('/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { errors, data } = validateMember(body, { partial: true });
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') errors.push('active must be true or false');
      else data.active = body.active;
    }
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nothing to change' });
    }

    // Filtering by organisationId means you can never touch another organisation's member.
    const target = await prisma.member.findFirst({
      where: { id: req.params.id, organisationId: req.user.organisationId },
    });
    if (!target) return res.status(404).json({ error: 'Member not found' });

    if (data.phone) {
      const clash = await prisma.member.findFirst({
        where: { organisationId: req.user.organisationId, phone: data.phone },
      });
      if (clash && clash.id !== target.id) {
        return res.status(409).json({ error: 'Another member already has this phone number' });
      }
    }

    const changes = {};
    Object.keys(data).forEach((key) => {
      if (data[key] !== target[key]) changes[key] = { from: target[key], to: data[key] };
    });
    if (Object.keys(changes).length === 0) {
      return res.json({ member: pickFields(target) });
    }

    const member = await prisma.$transaction(async (tx) => {
      const updated = await tx.member.update({
        where: { id: target.id },
        data,
        select: FIELDS,
      });
      await logAudit(tx, req, 'MEMBER_UPDATED', 'Member', target.id, changes);
      return updated;
    });

    res.json({ member });
  } catch (err) {
    next(err);
  }
});

function pickFields(m) {
  return { id: m.id, name: m.name, phone: m.phone, active: m.active, createdAt: m.createdAt };
}

module.exports = router;
