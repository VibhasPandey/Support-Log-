// Re-groups every saved entry using the current rules in taskTypes.js
const { db } = require("../db");
const { classifyTask } = require("../lib/normalize");

const rows = db.prepare("SELECT Id, Task, TaskType FROM SupportEntries").all();
const update = db.prepare(
  "UPDATE SupportEntries SET TaskType = @t WHERE Id = @id",
);

let changed = 0;
db.transaction(() => {
  for (const r of rows) {
    const type = r.Task === "(Not specified)" ? "Other" : classifyTask(r.Task);
    if (type !== r.TaskType) {
      update.run({ t: type, id: r.Id });
      changed++;
    }
  }
})();

console.log(`Checked ${rows.length} entries, re-grouped ${changed}.`);
