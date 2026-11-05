const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { clean, parseAmount, todayInZone, parseDateOnly } = require('../validate');
const { logAudit } = require('../audit');

const router = express.Router();

// Treasurer and assistant can both record and void payments. The audit log shows who did what.
router.use(requireAuth, requireRole('OWNER', 'ASSISTANT'));

const METHODS = ['CASH', 'MOBILE_MONEY'];

const PAYMENT_SELECT = {
  id: true,
  amount: true,
  paymentDate: true,
  method: true,
  mobileRef: true,
  notes: true,
  createdAt: true,
  voidedAt: true,
  voidReason: true,
  member: { select: { id: true, name: true } },
  contributionType: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
};

// paymentDate is stored as a date; send it back as plain YYYY-MM-DD.
function formatPayment(p) {
  return { ...p, paymentDate: p.paymentDate.toISOString().slice(0, 10) };
}

// Record a payment. Partial payments are simply separate payments.
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const orgId = req.user.organisationId;
    const errors = [];

    const memberId = clean(body.memberId);
    const contributionTypeId = clean(body.contributionTypeId);
    if (!memberId) errors.push('memberId is required');
    if (!contributionTypeId) errors.push('contributionTypeId is required');

    const method = clean(body.method).toUpperCase().replace(/[\s-]+/g, '_');
    if (!METHODS.includes(method)) errors.push('method must be CASH or MOBILE_MONEY');

    let mobileRef = null;
    if (method === 'MOBILE_MONEY') {
      mobileRef = clean(body.mobileRef).toUpperCase();
      if (mobileRef.length < 4 || mobileRef.length > 50) {
        errors.push('A mobile money reference (4 to 50 characters) is required');
      }
    }

    const today = todayInZone(config.timezone);
    let dateString = today;
    if (body.paymentDate !== undefined && body.paymentDate !== null && body.paymentDate !== '') {
      dateString = clean(body.paymentDate);
      if (!parseDateOnly(dateString)) {
        errors.push('paymentDate must be a real date written YYYY-MM-DD');
      } else if (dateString > today) {
        errors.push('paymentDate cannot be in the future');
      }
    }

    const notes = clean(body.notes);
    if (notes.length > 500) errors.push('Notes can be up to 500 characters');

    let explicitAmount = null;
    const amountGiven = body.amount !== undefined && body.amount !== null && body.amount !== '';
    if (amountGiven) {
      const parsed = parseAmount(body.amount);
      if (!parsed.ok) errors.push('Amount must be a whole number of shillings, 1 or more');
      else explicitAmount = parsed.value;
    }

    if (errors.length) return res.status(400).json({ error: errors.join('. ') });

    // Member and type must belong to this organisation and still be active.
    const member = await prisma.member.findFirst({ where: { id: memberId, organisationId: orgId } });
    if (!member) return res.status(400).json({ error: 'Member not found' });
    if (!member.active) return res.status(400).json({ error: 'This member is deactivated' });

    const type = await prisma.contributionType.findFirst({
      where: { id: contributionTypeId, organisationId: orgId },
    });
    if (!type) return res.status(400).json({ error: 'Contribution type not found' });
    if (!type.active) return res.status(400).json({ error: 'This contribution type is deactivated' });

    const amount = amountGiven ? explicitAmount : type.defaultAmount;
    if (!amount) {
      return res.status(400).json({ error: 'Amount is required: this contribution type has no default amount' });
    }

    // The same mobile money reference should never be entered twice (unless the first was voided).
    if (mobileRef) {
      const clash = await prisma.payment.findFirst({
        where: { organisationId: orgId, mobileRef, voidedAt: null },
        select: { paymentDate: true, member: { select: { name: true } } },
      });
      if (clash) {
        return res.status(409).json({
          error: `This mobile money reference was already recorded for ${clash.member.name} on ${clash.paymentDate
            .toISOString()
            .slice(0, 10)}`,
        });
      }
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          organisationId: orgId,
          memberId: member.id,
          contributionTypeId: type.id,
          amount,
          paymentDate: parseDateOnly(dateString),
          method,
          mobileRef,
          notes: notes || null,
          recordedById: req.user.id,
        },
        select: PAYMENT_SELECT,
      });
      await logAudit(tx, req, 'PAYMENT_CREATED', 'Payment', created.id, {
        member: member.name,
        contributionType: type.name,
        amount,
        paymentDate: dateString,
        method,
        mobileRef,
      });
      return created;
    });

    res.status(201).json({ payment: formatPayment(payment) });
  } catch (err) {
    next(err);
  }
});

// List payments, newest entry first. Voided payments are hidden unless ?includeVoided=true.
// Optional filters: memberId, contributionTypeId, method, from, to (YYYY-MM-DD), limit, page.
router.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const where = { organisationId: req.user.organisationId };

    if (q.includeVoided !== 'true') where.voidedAt = null;
    if (clean(q.memberId)) where.memberId = clean(q.memberId);
    if (clean(q.contributionTypeId)) where.contributionTypeId = clean(q.contributionTypeId);

    if (clean(q.method)) {
      const method = clean(q.method).toUpperCase();
      if (!METHODS.includes(method)) return res.status(400).json({ error: 'method must be CASH or MOBILE_MONEY' });
      where.method = method;
    }

    const range = {};
    if (clean(q.from)) {
      const from = parseDateOnly(clean(q.from));
      if (!from) return res.status(400).json({ error: 'from must be a date written YYYY-MM-DD' });
      range.gte = from;
    }
    if (clean(q.to)) {
      const to = parseDateOnly(clean(q.to));
      if (!to) return res.status(400).json({ error: 'to must be a date written YYYY-MM-DD' });
      range.lte = to;
    }
    if (range.gte || range.lte) where.paymentDate = range;

    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        select: PAYMENT_SELECT,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      prisma.payment.count({ where }),
    ]);

    res.json({ payments: payments.map(formatPayment), page, limit, total });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.id, organisationId: req.user.organisationId },
      select: PAYMENT_SELECT,
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json({ payment: formatPayment(payment) });
  } catch (err) {
    next(err);
  }
});

// Void a payment. It stays in the records, marked as cancelled with a reason and who did it.
// Payments cannot be edited or deleted: to correct one, void it and record the right one.
router.post('/:id/void', async (req, res, next) => {
  try {
    const reason = clean((req.body || {}).reason);
    if (reason.length < 3 || reason.length > 200) {
      return res.status(400).json({ error: 'A reason of 3 to 200 characters is required' });
    }

    const orgId = req.user.organisationId;
    const target = await prisma.payment.findFirst({ where: { id: req.params.id, organisationId: orgId } });
    if (!target) return res.status(404).json({ error: 'Payment not found' });
    if (target.voidedAt) return res.status(409).json({ error: 'This payment is already voided' });

    const payment = await prisma.$transaction(async (tx) => {
      // The voidedAt: null condition makes sure two people voiding at once cannot both succeed.
      const result = await tx.payment.updateMany({
        where: { id: target.id, organisationId: orgId, voidedAt: null },
        data: { voidedAt: new Date(), voidReason: reason, voidedById: req.user.id },
      });
      if (result.count === 0) return null;

      await logAudit(tx, req, 'PAYMENT_VOIDED', 'Payment', target.id, {
        reason,
        amount: target.amount,
        memberId: target.memberId,
        paymentDate: target.paymentDate.toISOString().slice(0, 10),
      });
      return tx.payment.findFirst({ where: { id: target.id }, select: PAYMENT_SELECT });
    });

    if (!payment) return res.status(409).json({ error: 'This payment is already voided' });
    res.json({ payment: formatPayment(payment) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
