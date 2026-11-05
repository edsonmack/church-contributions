require('dotenv').config();

const jwtSecret = process.env.JWT_SECRET || '';

// Fail fast: a missing or weak secret would make login tokens forgeable.
if (jwtSecret.length < 32) {
  console.error(
    'JWT_SECRET is missing or too short (needs 32+ characters). Generate one with:\n' +
      "  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"\n" +
      'then put it in your .env file.'
  );
  process.exit(1);
}

module.exports = {
  jwtSecret,
  jwtExpiresIn: '12h',
  port: process.env.PORT || 4000,
  allowSignup: String(process.env.ALLOW_SIGNUP).toLowerCase() !== 'false',
  corsOrigin: process.env.CORS_ORIGIN || true,
  timezone: process.env.APP_TIMEZONE || 'Africa/Dar_es_Salaam',
};
