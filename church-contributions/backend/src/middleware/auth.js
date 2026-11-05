const jwt = require('jsonwebtoken');
const prisma = require('../db');
const { jwtSecret } = require('../config');

// Requires a valid login token. The user is re-loaded from the database on every
// request, so a deactivated account or changed role takes effect immediately.
// Every later query must filter by req.user.organisationId: that is what keeps
// one organisation's data away from another's.
async function requireAuth(req, res, next) {
  try {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Login required' });
    }

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Account not found or disabled' });
    }

    req.user = {
      id: user.id,
      organisationId: user.organisationId,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    next();
  } catch (err) {
    next(err);
  }
}

// Use after requireAuth: requireRole('OWNER') or requireRole('OWNER', 'ASSISTANT').
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
