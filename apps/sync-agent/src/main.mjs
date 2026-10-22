#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Agent, VERSION } from './agent.mjs';

const configPath = process.env.MEDILINK_AGENT_CONFIG ?? path.resolve(process.cwd(), 'config.json');
let cfg;
try {
  cfg = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error(`Could not read ${configPath}. Copy config.example.json to config.json and fill it in.\n${e.message}`);
  process.exit(1);
}
cfg.key = process.env.MEDILINK_AGENT_KEY ?? cfg.key;
if (!cfg.key?.startsWith('mlk_')) {
  console.error('Missing agent key. Ask MediLink support for your key and put it in config.json or MEDILINK_AGENT_KEY.');
  process.exit(1);
}
cfg.stateFile ??= path.resolve(path.dirname(configPath), 'state.json');

const ts = () => new Date().toLocaleTimeString('en-IN', { hour12: false });
const log = {
  info: (m) => console.log(`[${ts()}] ${m}`),
  warn: (m) => console.warn(`[${ts()}] WARN ${m}`),
  error: (m) => console.error(`[${ts()}] ERROR ${m}`),
};

const agent = new Agent(cfg, { log });
await agent.loadState();
log.info(`MediLink sync agent ${VERSION} started. Syncing every ${cfg.intervalSeconds ?? 60}s.`);

let failures = 0;
async function run() {
  try {
    const r = await agent.cycle();
    failures = 0;
    if (r.stock || r.orders || r.bills) log.info(`Synced: stock ${r.stock ? r.stock.sent : 'unchanged'}, ${r.orders} new orders, ${r.bills} bills`);
  } catch (e) {
    failures++;
    log.error(`${e.message}${failures > 2 ? ' (check the internet connection on this PC)' : ''}`);
  }
}

if (process.argv.includes('--once')) {
  await run();
} else {
  // Back off up to 5 minutes while offline so we do not hammer the network.
  const loop = async () => {
    await run();
    const base = (cfg.intervalSeconds ?? 60) * 1000;
    setTimeout(loop, Math.min(300_000, base * 2 ** Math.min(failures, 3)));
  };
  loop();
}
