import { verifyAll } from './agent-skills.mjs';

try {
  verifyAll();
} catch (error) {
  console.error(`校验失败：${error.message}`);
  process.exitCode = 1;
}
