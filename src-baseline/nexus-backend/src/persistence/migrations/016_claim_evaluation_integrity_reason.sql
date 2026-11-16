-- Evidence Integrity guard (CP-16, ADR-004). ADDITIVE ONLY: one nullable column on claim_evaluations (migration 012) that records WHY the
-- engine's result is what it is, from the integrity guard's point of view: NO_EVIDENCE | CONSENSUS_ONLY | INDEPENDENT_EVIDENCE |
-- EXECUTABLE_VERIFICATION | CONTRADICTORY_EVIDENCE. NULL for rows written before this migration and for ran=0 rows (the engine determined
-- nothing). No existing column, row or index is touched; no backfill is attempted (the reason of an old row cannot be re-derived honestly).
ALTER TABLE claim_evaluations ADD COLUMN integrity_reason TEXT;
