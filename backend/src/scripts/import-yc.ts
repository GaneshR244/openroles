import { NestFactory } from '@nestjs/core';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { YcImportService } from '../ingestion/yc-import.service.js';
import { BoardFinderService } from '../ingestion/board-finder.service.js';
import { flag } from './script-args.js';

// One-time seed: `npm run seed:yc` imports YC companies that are hiring.
// Add `-- --find-boards=500` to probe that many companies for job boards right away
// (the daily run probes MAX_COMPANY_PROBES per morning).

async function main(): Promise<void> {
  const findBoards = Number(flag(process.argv.slice(2), 'find-boards') ?? 0);
  const app = await NestFactory.createApplicationContext(IngestionModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const imported = await app.get(YcImportService).run();
    console.log(
      `YC: ${imported.total} companies, ${imported.hiring} hiring, ${imported.created} new`,
    );
    if (findBoards > 0) {
      const now = new Date();
      const found = await app.get(BoardFinderService).run({
        now,
        deadline: new Date(now.getTime() + 3 * 3_600_000),
        limit: findBoards,
      });
      console.log(
        `Board finder: ${found.probedCompanies} checked, ${found.boardsFound} boards found`,
      );
    }
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
