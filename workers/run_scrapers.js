import { runMekimi } from '../scrapers/mekimi_scraper.js';

(async () => {
  console.log('Starting scrapers...');
  await runMekimi();
  console.log('Done');
  process.exit(0);
})();
