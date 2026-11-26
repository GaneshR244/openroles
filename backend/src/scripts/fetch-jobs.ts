import { NestFactory } from '@nestjs/core';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { RunOrchestratorService } from '../ingestion/run-orchestrator.service.js';
import { flag, parseSource } from './script-args.js';

// The daily script cron runs: `npm run jobs:fetch -- --trigger=cron`.
// Runs once and exits. Exit code 1 only when the whole run failed.
// Flags: --source=greenhouse|lever|ashby|smartrecruiters|workable  --trigger=cron|manual
//        --import-boards   run the Common Crawl board import now (otherwise it runs monthly)

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const only = parseSource(flag(argv, 'source'));
  const trigger = flag(argv, 'trigger') === 'cron' ? 'cron' : 'manual';
  const importBoards = argv.includes('--import-boards') ? 'force' : 'auto';

  const app = await NestFactory.createApplicationContext(IngestionModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const result = await app.get(RunOrchestratorService).run({ trigger, only, importBoards });
    if (result.status === 'SKIPPED') return 0;
    console.log(`\n${result.summary}\n`);
    return result.status === 'FAILED' ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
