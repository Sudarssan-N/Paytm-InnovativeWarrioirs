// Runs the document check over its evaluation set and writes the scorecard.
// No network: the cases are the sample papers, as read, then changed on purpose.
// Run: node scripts/eval-doc-check.mjs
import { writeFileSync } from 'node:fs';
import { runCases, TODAY } from './doc-check-cases.mjs';
import { DOC_CHECK_PACK } from '../src/journeys/engines/docCheck.js';

const results = runCases();
const groups = {};
for (const item of results) {
  groups[item.group] ||= { cases: 0, passed: 0 };
  groups[item.group].cases += 1;
  groups[item.group].passed += item.pass ? 1 : 0;
}
const genuine = results.filter((item) => item.group === 'genuine');
const report = {
  ranOn: new Date().toISOString(), today: TODAY, pack: `${DOC_CHECK_PACK.label}, as of ${DOC_CHECK_PACK.asOf}`,
  cases: results.length, passed: results.filter((item) => item.pass).length,
  falseAlarms: genuine.filter((item) => item.got !== 'clean').length, missed: results.filter((item) => item.group !== 'genuine' && item.got === 'clean').length,
  groups, failures: results.filter((item) => !item.pass), results,
  limits: 'Synthetic forgeries made from the sample papers. Real forgeries can be subtler, and real genuine papers come from many more systems than these samples.',
};
writeFileSync('docs/evaluations/doc-check.json', `${JSON.stringify(report, null, 1)}\n`);

for (const item of results) console.log(`${item.pass ? 'pass' : 'FAIL'}  ${item.id.padEnd(36)} expected ${item.expect.padEnd(8)} got ${item.got.padEnd(8)} ${item.flags.join(', ')}`);
console.log(`\n${report.passed} of ${report.cases} cases. ${report.falseAlarms} false alarms on genuine papers, ${report.missed} changed papers missed.`);
process.exitCode = report.passed === report.cases ? 0 : 1;
