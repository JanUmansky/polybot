import { createLogger } from './logger.js';
import { startOrchestrator } from './orchestrator.js';

const logger = createLogger();

logger.banner();

startOrchestrator().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
