const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { clean, todayInZone } = require('../validate');
const { logAudit } = require('../audit');

const router = express.Router();
const ExcelJS = require('exceljs');

router.use(requireAuth, requireRole('OWNER', 'ASSISTANT'));

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const isoDate = (d) => d.toISOString().slice(0, 10);

// First and last day of a month (YYYY-MM), as dates at midnight UTC.
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
}

function yearRange(year) {
  const y = Number(year);
  return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y, 12, 0)) };
}

// Which payments belong to a period (a month range or a year range).
// A contribution type tied to a month (startMonth) counts in that month, whenever the money arrived.
// A type with no month counts by the date the money was received.
// With basis "received", every payment counts by the date the money was received, whatever its type.
function paymentsInPeriod(orgId, range, basis) {
  if (basis === 'received') return { organisationId: orgId, paymentDate: { gte: range.from, lte: range.to } };
  const fromMonth = isoDate(range.from).slice(0, 7);
  const toMonth = isoDate(range.to).slice(0, 7);
  return {
    organisationId: orgId,
    OR: [
      { contributionType: { startMonth: null }, paymentDate: { gte: range.from, lte: range.to } },
      { contributionType: { startMonth: { gte: fromMonth, lte: toMonth } } },
    ],
  };
}

// The month a payment counts for: its type's month if it has one, else the month it was received.
const effectiveMonth = (p, basis) =>
  (basis !== 'received' && p.contributionType && p.contributionType.startMonth) || isoDate(p.paymentDate).slice(0, 7);

// ?basis=contribution (default) or ?basis=received. Returns null when the value is not allowed.
function parseBasis(value) {
  const v = clean(value) || 'contribution';
  return v === 'contribution' || v === 'received' ? v : null;
}
const BASIS_ERROR = 'basis must be contribution or received';

// Builds the monthly status report for one contribution type. Shared by the screen and the Excel export.
// For a type tied to a month, that month is used (whatever month was asked for) and payments count
// whenever they were received. Otherwise payments are counted by the date they were received.
async function monthlyStatus(orgId, type, askedMonth, basis) {
  const byReceived = basis === 'received';
  const month = (!byReceived && type.startMonth) || askedMonth;
  const { from, to } = monthRange(month);

  const where = { organisationId: orgId, contributionTypeId: type.id, voidedAt: null };
  if (byReceived || !type.startMonth) where.paymentDate = { gte: from, lte: to };
  const payments = await prisma.payment.findMany({
    where,
    select: { memberId: true, amount: true },
  });

  const paidBy = new Map();
  payments.forEach((p) => paidBy.set(p.memberId, (paidBy.get(p.memberId) || 0) + p.amount));

  // Everyone active is expected to pay. Someone deactivated since still appears if they paid.
  const memberSelect = { id: true, name: true, phone: true };
  const active = await prisma.member.findMany({
    where: { organisationId: orgId, active: true },
    select: memberSelect,
  });
  const activeIds = new Set(active.map((m) => m.id));
  const extraIds = [...paidBy.keys()].filter((id) => !activeIds.has(id));
  const extra = extraIds.length
    ? await prisma.member.findMany({
        where: { organisationId: orgId, id: { in: extraIds } },
        select: memberSelect,
      })
    : [];

  const expected = type.defaultAmount;
  const members = [...active, ...extra].map((m) => {
    const paid = paidBy.get(m.id) || 0;
    const status = paid >= expected ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
    return {
      memberId: m.id,
      name: m.name,
      phone: m.phone,
      paid,
      owing: Math.max(expected - paid, 0),
      status,
    };
  });

  // People who still owe come first.
  const order = { UNPAID: 0, PARTIAL: 1, PAID: 2 };
  members.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));

  const count = (status) => members.filter((m) => m.status === status).length;
  return {
    month,
    period: { from: isoDate(from), to: isoDate(to) },
    contributionType: { id: type.id, name: type.name, defaultAmount: expected, startMonth: type.startMonth || null },
    totals: {
      memberCount: members.length,
      paidCount: count('PAID'),
      partialCount: count('PARTIAL'),
      unpaidCount: count('UNPAID'),
      expected: members.length * expected,
      collected: members.reduce((sum, m) => sum + m.paid, 0),
      outstanding: members.reduce((sum, m) => sum + m.owing, 0),
    },
    members,
  };
}

// Money collected in a period. Pass the year (YYYY) to also get the total for each month of it.
async function summarise(orgId, range, yearParam, basis) {
  const rows = await prisma.payment.findMany({
    where: paymentsInPeriod(orgId, range, basis),
    select: {
      amount: true,
      method: true,
      paymentDate: true,
      voidedAt: true,
      contributionType: { select: { id: true, name: true, startMonth: true } },
    },
  });

  let totalCollected = 0;
  let paymentCount = 0;
  const voided = { count: 0, total: 0 };
  const byMethod = { CASH: { total: 0, count: 0 }, MOBILE_MONEY: { total: 0, count: 0 } };
  const byType = new Map();
  const byMonth = new Map();

  if (yearParam) {
    for (let m = 1; m <= 12; m += 1) {
      byMonth.set(`${yearParam}-${String(m).padStart(2, '0')}`, { month: `${yearParam}-${String(m).padStart(2, '0')}`, total: 0, count: 0 });
    }
  }

  rows.forEach((p) => {
    if (p.voidedAt) {
      voided.count += 1;
      voided.total += p.amount;
      return;
    }
    totalCollected += p.amount;
    paymentCount += 1;

    byMethod[p.method].total += p.amount;
    byMethod[p.method].count += 1;

    const t = byType.get(p.contributionType.id) || {
      contributionTypeId: p.contributionType.id,
      name: p.contributionType.name,
      total: 0,
      count: 0,
    };
    t.total += p.amount;
    t.count += 1;
    byType.set(p.contributionType.id, t);

    const bucket = byMonth.get(effectiveMonth(p, basis));
    if (bucket) {
      bucket.total += p.amount;
      bucket.count += 1;
    }
  });

  const response = {
    period: { from: isoDate(range.from), to: isoDate(range.to) },
    totalCollected,
    paymentCount,
    byContributionType: [...byType.values()].sort((a, b) => b.total - a.total),
    byMethod,
    voided,
  };
  if (yearParam) response.byMonth = [...byMonth.values()];
  return response;
}

// Who has paid, paid part, or not paid for one contribution type in one month.
// Payments are counted by the date money was received (paymentDate), never by entry time,
// unless the contribution type is tied to a month (startMonth). Then its payments count for that
// month whenever they were received, and the month asked for is ignored.
// Voided payments are ignored. Several partial payments add up.
// GET /api/reports/monthly?contributionTypeId=...&month=2026-11   (month defaults to this month)
router.get('/monthly', async (req, res, next) => {
  try {
    const orgId = req.user.organisationId;

    const month = clean(req.query.month) || todayInZone(config.timezone).slice(0, 7);
    if (!MONTH_RE.test(month)) {
      return res.status(400).json({ error: 'month must be written YYYY-MM, for example 2026-11' });
    }

    const typeId = clean(req.query.contributionTypeId);
    if (!typeId) return res.status(400).json({ error: 'contributionTypeId is required' });

    const type = await prisma.contributionType.findFirst({
      where: { id: typeId, organisationId: orgId },
    });
    if (!type) return res.status(404).json({ error: 'Contribution type not found' });
    if (!type.defaultAmount) {
      return res.status(400).json({
        error:
          'This contribution type has no default amount, so there is nothing to compare payments against. Use the summary report instead.',
      });
    }

    res.json(await monthlyStatus(orgId, type, month));
  } catch (err) {
    next(err);
  }
});

// Money collected in a period, split by contribution type and by payment method.
// GET /api/reports/summary?month=2026-11    or    ?year=2026   (defaults to this month)
// With ?year=, also returns the total for each month of that year.
router.get('/summary', async (req, res, next) => {
  try {
    const orgId = req.user.organisationId;
    const monthParam = clean(req.query.month);
    const yearParam = clean(req.query.year);
    const basis = parseBasis(req.query.basis);
    if (!basis) return res.status(400).json({ error: BASIS_ERROR });

    if (monthParam && yearParam) {
      return res.status(400).json({ error: 'Use either month or year, not both' });
    }

    let range;
    if (yearParam) {
      const y = Number(yearParam);
      if (!/^\d{4}$/.test(yearParam) || y < 2000 || y > 2100) {
        return res.status(400).json({ error: 'year must be four digits, for example 2026' });
      }
      range = yearRange(yearParam);
    } else {
      const month = monthParam || todayInZone(config.timezone).slice(0, 7);
      if (!MONTH_RE.test(month)) {
        return res.status(400).json({ error: 'month must be written YYYY-MM, for example 2026-11' });
      }
      range = monthRange(month);
    }

    const response = await summarise(orgId, range, yearParam, basis);
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ---------- Excel export ----------

const INK = 'FF1F3A93';
const TZS_FORMAT = '#,##0';
const METHOD_LABEL = { CASH: 'Cash', MOBILE_MONEY: 'Mobile money' };
const STATUS_LABEL = { PAID: 'Paid', PARTIAL: 'Part paid', UNPAID: 'Not paid' };

function monthName(month) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// A time shown the way people in Tanzania read it, for example "2026-11-04 23:15".
function tanzaniaTime(date) {
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
  row.alignment = { vertical: 'middle', wrapText: true };
}

// GET /api/reports/export?month=2026-11    or    ?year=2026
// An Excel file with a summary, every payment in the period (voided ones marked), and for a month
// also who has paid or still owes for each contribution that has a usual amount.
router.get('/export', async (req, res, next) => {
  try {
    const orgId = req.user.organisationId;
    const monthParam = clean(req.query.month);
    const yearParam = clean(req.query.year);
    const basis = parseBasis(req.query.basis);
    if (!basis) return res.status(400).json({ error: BASIS_ERROR });
    const byReceived = basis === 'received';

    if (monthParam && yearParam) {
      return res.status(400).json({ error: 'Use either month or year, not both' });
    }

    let range;
    let label;
    let fileLabel;
    if (yearParam) {
      const y = Number(yearParam);
      if (!/^\d{4}$/.test(yearParam) || y < 2000 || y > 2100) {
        return res.status(400).json({ error: 'year must be four digits, for example 2026' });
      }
      range = yearRange(yearParam);
      label = yearParam;
      fileLabel = yearParam;
    } else {
      const month = monthParam || todayInZone(config.timezone).slice(0, 7);
      if (!MONTH_RE.test(month)) {
        return res.status(400).json({ error: 'month must be written YYYY-MM, for example 2026-11' });
      }
      range = monthRange(month);
      label = monthName(month);
      fileLabel = month;
    }

    const org = await prisma.organisation.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    const summary = await summarise(orgId, range, yearParam || null, basis);

    const payments = await prisma.payment.findMany({
      where: paymentsInPeriod(orgId, range, basis),
      orderBy: { paymentDate: 'asc' },
      select: {
        amount: true,
        method: true,
        mobileRef: true,
        paymentDate: true,
        notes: true,
        createdAt: true,
        voidedAt: true,
        voidReason: true,
        member: { select: { name: true, phone: true } },
        contributionType: { select: { name: true, startMonth: true } },
        recordedBy: { select: { name: true } },
        voidedBy: { select: { name: true } },
      },
    });
    payments.sort((a, b) => a.paymentDate - b.paymentDate || a.createdAt - b.createdAt);

    const wb = new ExcelJS.Workbook();
    wb.creator = org ? org.name : 'Contributions';
    wb.created = new Date();

    // --- Summary ---
    const ws = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 34 }, { width: 18 }, { width: 14 }];
    ws.addRow([org ? org.name : '']).font = { bold: true, size: 16, color: { argb: INK } };
    ws.addRow([byReceived ? `Contributions received in ${label}` : `Contributions for ${label}`]).font = { size: 12 };
    ws.addRow([
      byReceived
        ? 'Every payment counts in the month the money was received, whatever month the contribution is for.'
        : 'Each contribution counts in the month it belongs to, whenever the money was received.',
    ]).font = {
      italic: true,
      color: { argb: 'FF666666' },
    };
    ws.addRow([`Period: ${summary.period.from} to ${summary.period.to}`]);
    ws.addRow([`Prepared ${tanzaniaTime(new Date())} (Tanzania time). All amounts are Tanzanian shillings (TZS).`]).font = {
      italic: true,
      color: { argb: 'FF666666' },
    };
    ws.addRow([]);

    const section = (title, headers) => {
      const t = ws.addRow([title]);
      t.font = { bold: true, size: 12, color: { argb: INK } };
      const h = ws.addRow(headers);
      styleHeader(h);
    };
    const money = (row, cols) => cols.forEach((c) => (row.getCell(c).numFmt = TZS_FORMAT));

    section('Total', ['', 'Amount (TZS)', 'Payments']);
    const total = ws.addRow(['Total collected', summary.totalCollected, summary.paymentCount]);
    total.font = { bold: true };
    money(total, [2]);
    ws.addRow([]);

    section('By contribution', ['Contribution', 'Amount (TZS)', 'Payments']);
    if (summary.byContributionType.length === 0) ws.addRow(['No payments in this period']);
    summary.byContributionType.forEach((t) => money(ws.addRow([t.name, t.total, t.count]), [2]));
    ws.addRow([]);

    section('By payment method', ['Method', 'Amount (TZS)', 'Payments']);
    Object.entries(summary.byMethod).forEach(([m, v]) => money(ws.addRow([METHOD_LABEL[m], v.total, v.count]), [2]));
    ws.addRow([]);

    if (summary.byMonth) {
      section('By month', ['Month', 'Amount (TZS)', 'Payments']);
      summary.byMonth.forEach((m) => money(ws.addRow([monthName(m.month), m.total, m.count]), [2]));
      ws.addRow([]);
    }

    section('Voided payments (not counted above)', ['', 'Amount (TZS)', 'Payments']);
    money(ws.addRow(['Voided', summary.voided.total, summary.voided.count]), [2]);

    // --- Payments ---
    const wp = wb.addWorksheet('Payments', { views: [{ state: 'frozen', ySplit: 1 }] });
    wp.columns = [
      { header: 'Date received', key: 'date', width: 14 },
      { header: 'Member', key: 'member', width: 26 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Contribution', key: 'type', width: 22 },
      { header: 'Counts for month', key: 'forMonth', width: 18 },
      { header: 'Amount (TZS)', key: 'amount', width: 15, style: { numFmt: TZS_FORMAT } },
      { header: 'Paid by', key: 'method', width: 14 },
      { header: 'Mobile money reference', key: 'ref', width: 24 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Recorded by', key: 'by', width: 18 },
      { header: 'Recorded at', key: 'at', width: 18 },
      { header: 'Void reason', key: 'voidReason', width: 30 },
      { header: 'Voided by', key: 'voidedBy', width: 18 },
      { header: 'Note', key: 'notes', width: 30 },
    ];
    styleHeader(wp.getRow(1));
    payments.forEach((p) => {
      const row = wp.addRow({
        date: p.paymentDate,
        member: p.member ? p.member.name : '',
        phone: p.member && p.member.phone ? p.member.phone : '',
        type: p.contributionType ? p.contributionType.name : '',
        forMonth: monthName(effectiveMonth(p)),
        amount: p.amount,
        method: METHOD_LABEL[p.method] || p.method,
        ref: p.mobileRef || '',
        status: p.voidedAt ? 'VOIDED' : 'Valid',
        by: p.recordedBy ? p.recordedBy.name : '',
        at: tanzaniaTime(p.createdAt),
        voidReason: p.voidReason || '',
        voidedBy: p.voidedBy ? p.voidedBy.name : '',
        notes: p.notes || '',
      });
      row.getCell('date').numFmt = 'yyyy-mm-dd';
      row.getCell('phone').numFmt = '@';
      if (p.voidedAt) row.font = { strike: true, color: { argb: 'FFB3261E' } };
    });
    wp.autoFilter = { from: 'A1', to: 'N1' };

    // --- Who has paid (one month only) ---
    if (monthParam || !yearParam) {
      const month = range.from.toISOString().slice(0, 7);
      const types = await prisma.contributionType.findMany({
        where: { organisationId: orgId, active: true },
        orderBy: { name: 'asc' },
      });
      // A type tied to another month belongs in that month's file, not this one.
      const withAmount = types.filter((t) => t.defaultAmount && (byReceived || !t.startMonth || t.startMonth === month));
      if (withAmount.length) {
        const wm = wb.addWorksheet('Who has paid', { views: [{ state: 'frozen', ySplit: 1 }] });
        wm.columns = [
          { header: 'Contribution', key: 'type', width: 22 },
          { header: 'Member', key: 'member', width: 26 },
          { header: 'Phone', key: 'phone', width: 16 },
          { header: 'Usual amount (TZS)', key: 'expected', width: 18, style: { numFmt: TZS_FORMAT } },
          { header: 'Paid (TZS)', key: 'paid', width: 14, style: { numFmt: TZS_FORMAT } },
          { header: 'Still owing (TZS)', key: 'owing', width: 17, style: { numFmt: TZS_FORMAT } },
          { header: 'Status', key: 'status', width: 12 },
        ];
        styleHeader(wm.getRow(1));
        for (const type of withAmount) {
          const report = await monthlyStatus(orgId, type, month, basis);
          report.members.forEach((m) => {
            const row = wm.addRow({
              type: type.name,
              member: m.name,
              phone: m.phone || '',
              expected: type.defaultAmount,
              paid: m.paid,
              owing: m.owing,
              status: STATUS_LABEL[m.status],
            });
            row.getCell('phone').numFmt = '@';
          });
        }
      }
    }

    await logAudit(prisma, req, 'REPORT_EXPORTED', 'Report', fileLabel, {
      period: summary.period,
      basis,
      payments: payments.length,
    });

    const buffer = await wb.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="contributions-${fileLabel}${byReceived ? '-received' : ''}.xlsx"`,
      'Cache-Control': 'no-store',
    });
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
