const Database = require('better-sqlite3');
const db = new Database('smm_matrix_complete.db');

[
  'orders','posts','users','plans','reviews','tickets',
  'metrics','targets','statuses','subscribers'
].forEach(t=>{
  try { db.exec(`DROP TABLE IF EXISTS ${t};`); console.log('dropped',t); } catch(e){ console.error('err dropping',t,e.message); }
});
db.close();
console.log('Dropped tables (if existed). Now start your app to recreate schema.');
