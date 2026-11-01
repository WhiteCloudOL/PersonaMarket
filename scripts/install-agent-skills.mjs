import { installAll, verifyAll } from './agent-skills.mjs';

try {
  installAll();
  verifyAll();
} catch (error) {
  console.error(`安装失败：${error.message}`);
  process.exitCode = 1;
}
