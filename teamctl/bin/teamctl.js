#!/usr/bin/env node
// teamctl CLI 진입점. 현재: serve (컨트롤 브리지 D14).
import { serve } from '../src/server/serve.js';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'serve';
const pi = argv.indexOf('--port');
const port = pi >= 0 ? Number(argv[pi + 1]) : undefined;

if (cmd === 'serve') {
  serve({ port }).catch((e) => {
    console.error('[teamctl] 서버 시작 실패:', e.message);
    process.exit(1);
  });
} else if (cmd === 'help' || cmd === '--help') {
  console.log('usage: teamctl serve [--port 7420]');
} else {
  console.error(`알 수 없는 명령: ${cmd}\nusage: teamctl serve [--port 7420]`);
  process.exit(1);
}
