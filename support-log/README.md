# Support log

Logs IT support requests to SQL Server, shows management-ready reports, and imports/exports
your existing `IT_Support.xlsx` format.

## Setup
1. Run `schema.sql` in SSMS.
2. Copy `.env.example` to `.env` and fill in the SQL login. Set `DEFAULT_RESPONDER` to your name as it appears in the sheet.
3. `npm install`, then `npm start`, then open http://localhost:3000
4. Go to **Import / export**, choose `IT_Support.xlsx`, click **Check file**, then **Import**.

## How the import works
- Every tab with the headers `S No. | Date | Task | Module | Requested By | Responsed By | Duration(mins) | Remarks` is read.
- Rows are matched on *Responsed By + S No.* Re-uploading adds new rows, updates edited rows, and never duplicates.
- Names, tasks and modules are tidied (extra spaces removed, "AJAY KUMAR" becomes "Ajay Kumar") so the same person or task is counted once.
- A duration of `_` or blank counts as 0 minutes.
- Pick one place to enter data. If you add rows in both the sheet and the web form, the same S No. can be given to two different requests and the upload will overwrite the web entry.

## Grouping tasks into types
The report's "By type of request" comes from keywords in the Task text, defined in `taskTypes.js`.
Edit the rules, then run `npm run reclassify` to regroup what is already saved.
