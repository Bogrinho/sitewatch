ALTER TABLE checks ADD COLUMN timing_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE checks ADD COLUMN outcome TEXT NOT NULL DEFAULT 'target';
UPDATE monitors SET slow_streak=0;
