import { importCalendar } from '../src/events.mjs';

const args = process.argv.slice(2);
const usage = 'Usage: node bin/events.mjs <calendar-url>';
if (args.length === 1 && args[0] === '--help') {
  console.log(usage);
} else if (args.length !== 1) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const calendar = await importCalendar(args[0]);
    console.log(JSON.stringify(calendar, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
