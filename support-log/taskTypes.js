// How a free-text Task is grouped for the reports. The FIRST matching rule wins,
// so keep the more specific rules at the top. Anything unmatched becomes "Other".
// After editing, run:  npm run reclassify   (re-groups every row already in the database)
module.exports = [
  ['Training',                      /training/i],
  ['Attendance & leave',            /attendance|leave|levae|comp ?off|late login/i],
  ['Visit & distance',              /visit|distance|tracking/i],
  ['Customer visibility / mapping', /visibility|not visible|mapp/i],
  ['Sales order help',              /sales order|\bso\b|order|item code/i],
  ['Login & password',              /password|credential|login|logout|relogin|log in|authori[sz]ation|forgot/i],
  ['Data correction',               /correction|updation|update/i],
  ['Registration & creation',       /registration|creation|creat|new dealer|new customer|joining/i],
  ['App & setup help',              /\bapp\b|install|download|set ?up|mail|link|laptop|network|anydesk/i],
];
