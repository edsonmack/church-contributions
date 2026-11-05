// Writes one audit log row. Pass the transaction client (tx) so the log entry
// is saved together with the change it describes, or not at all.
function logAudit(tx, req, action, entity, entityId, details) {
  return tx.auditLog.create({
    data: {
      organisationId: req.user.organisationId,
      userId: req.user.id,
      action,
      entity,
      entityId,
      details,
    },
  });
}

module.exports = { logAudit };
