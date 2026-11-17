import { serve } from '@hono/node-server';
import { composeServer } from './composition-root.js';
import { loadConfig } from './config.js';

function main(): void {
  const config = loadConfig(process.env);
  const app = composeServer(config);
  const planner = config.anthropic.apiKey ? `Claude (${config.anthropic.model})` : 'demo planner (no ANTHROPIC_API_KEY)';
  const providers = config.runway.apiKey ? 'Runway' : 'mock providers (no RUNWAYML_API_SECRET)';
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`shot-planner API on http://localhost:${info.port}`);
    console.log(`  planner:   ${planner}`);
    console.log(`  providers: ${providers}`);
  });
}

main();
