const { PrismaClient } = require('@prisma/client');

// One shared database client for the whole app.
module.exports = new PrismaClient();
