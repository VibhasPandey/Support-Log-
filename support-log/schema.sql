-- One row per line of your IT_Support sheet.
-- COLLATE NOCASE keeps SQL Server's case-insensitive behaviour for names and tasks.
CREATE TABLE IF NOT EXISTS SupportEntries (
    Id           INTEGER PRIMARY KEY AUTOINCREMENT,
    SNo          INTEGER NOT NULL,                              -- "S No." in the sheet, numbered per person
    SNoSeq       INTEGER NOT NULL DEFAULT 1,                    -- 2 if the sheet reuses an S No. by mistake
    EntryDate    TEXT    NOT NULL,                              -- "Date", stored as YYYY-MM-DD
    Task         TEXT    NOT NULL COLLATE NOCASE,               -- "Task"
    TaskType     TEXT    NOT NULL DEFAULT 'Other',              -- grouped automatically (see taskTypes.js)
    Module       TEXT    COLLATE NOCASE,                        -- "Module" (CRM, HRMS, Infra...)
    RequestedBy  TEXT    NOT NULL COLLATE NOCASE,               -- "Requested By"
    RespondedBy  TEXT    NOT NULL COLLATE NOCASE,               -- "Responsed By"
    DurationMins REAL    NOT NULL DEFAULT 0 CHECK (DurationMins BETWEEN 0 AND 600),
    Remarks      TEXT,
    CreatedAt    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Re-uploading a sheet matches rows on person + S No., so nothing is duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS UX_SupportEntries_Person_SNo ON SupportEntries (RespondedBy, SNo, SNoSeq);
CREATE INDEX IF NOT EXISTS IX_SupportEntries_EntryDate ON SupportEntries (EntryDate);