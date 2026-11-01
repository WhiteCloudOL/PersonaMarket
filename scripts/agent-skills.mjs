import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const agentsRoot = join(projectRoot, '.agents');
const skillsRoot = join(agentsRoot, 'skills');
const lockPath = new URL('./agent-skills.lock.json', import.meta.url);

function inside(root, child) {
  const path = relative(root, child);
  if (
    !path ||
    isAbsolute(path) ||
    path === '..' ||
    path.startsWith(`..${sep}`) ||
    resolve(root, path) !== child
  ) {
    throw new Error(`路径必须位于指定目录内：${child}`);
  }
  return child;
}

function plainDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`目录不能是符号链接：${path}`);
  }
}

function filesIn(root, current = root) {
  plainDirectory(current);
  return readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(current, entry.name);
      if (entry.isDirectory()) return filesIn(root, path);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(`Skill 不允许符号链接或特殊文件：${path}`);
      }
      return [relative(root, path).split(sep).join('/')];
    })
    .sort();
}

export function loadLock() {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.version !== 1 || !Array.isArray(lock.skills) || lock.skills.length !== 4) {
    throw new Error('Skill 锁定清单格式错误。');
  }
  const names = new Set();
  for (const skill of lock.skills) {
    if (
      !/^[a-z][a-z0-9-]+$/.test(skill.name) ||
      names.has(skill.name) ||
      !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(skill.repository) ||
      !/^[a-f0-9]{40}$/.test(skill.commit) ||
      !/^skills\/[a-z0-9-]+$/.test(skill.path) ||
      !skill.files?.['SKILL.md']
    ) {
      throw new Error('Skill 来源或名称格式错误。');
    }
    names.add(skill.name);
    for (const [file, hash] of Object.entries(skill.files)) {
      if (
        !/^[a-zA-Z0-9_./-]+$/.test(file) ||
        file.split('/').some((part) => part === '..' || part === '.' || !part) ||
        !/^[a-f0-9]{64}$/.test(hash)
      ) {
        throw new Error(`Skill 文件清单错误：${skill.name}/${file}`);
      }
    }
    for (const [destination, source] of Object.entries(skill.extraFiles ?? {})) {
      if (!skill.files[destination] || !/^[a-zA-Z0-9_.-]+$/.test(source)) {
        throw new Error(`附加文件清单错误：${skill.name}`);
      }
    }
  }
  return lock;
}

export function verifySkill(skill, directory = join(skillsRoot, skill.name)) {
  const actual = filesIn(directory);
  const expected = Object.keys(skill.files).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Skill 文件缺失或存在未登记文件：${skill.name}`);
  }
  for (const file of expected) {
    const bytes = readFileSync(inside(directory, resolve(directory, file)));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== skill.files[file]) {
      throw new Error(
        `Skill 文件内容发生变化：${skill.name}/${file}；请审查变更，安装器不会覆盖。`,
      );
    }
  }
  const main = readFileSync(join(directory, 'SKILL.md'), 'utf8');
  if (
    !main.startsWith('---\n') ||
    !main.includes(`\nname: ${skill.name}\n`) ||
    !/^description:/m.test(main)
  ) {
    throw new Error(`Skill 元信息不正确：${skill.name}`);
  }
  // 检查主文件中的本地 Markdown 引用，避免只复制 SKILL.md 后误报安装完成。
  for (const match of main.matchAll(/\]\(\.\/([^\s)#]+)(?:#[^)]*)?\)/g)) {
    if (!skill.files[match[1]]) throw new Error(`Skill 引用文件缺失：${skill.name}/${match[1]}`);
  }
  return expected.length;
}

export function verifyAll() {
  plainDirectory(agentsRoot);
  plainDirectory(skillsRoot);
  let total = 0;
  for (const skill of loadLock().skills) {
    const count = verifySkill(skill);
    total += count;
    console.log(`通过：${skill.name}（${count} 个文件，SHA-256 一致）`);
  }
  console.log(`项目级 Skills 校验通过：4 个 Skill，共 ${total} 个文件。`);
}

function git(directory, hooks, args) {
  const result = spawnSync(
    'git',
    ['-c', `core.hooksPath=${hooks}`, '-c', 'core.autocrlf=false', '-C', directory, ...args],
    {
      encoding: 'utf8',
      timeout: 180_000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`Git 下载失败：${result.error?.message ?? result.stderr.trim()}`);
  }
}

export function installAll() {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error('安装器要求 Node.js 24 或更高版本；本项目使用 Node.js 24 LTS。');
  }
  mkdirSync(agentsRoot, { recursive: true });
  plainDirectory(agentsRoot);
  mkdirSync(skillsRoot, { recursive: true });
  plainDirectory(skillsRoot);
  const lock = loadLock();
  const missing = [];
  for (const skill of lock.skills) {
    const destination = inside(skillsRoot, join(skillsRoot, skill.name));
    if (existsSync(destination)) {
      verifySkill(skill, destination);
      console.log(`已安装且校验通过：${skill.name}`);
    } else {
      missing.push(skill);
    }
  }
  if (missing.length === 0) return;

  const temporary = mkdtempSync(join(agentsRoot, '.skill-install-'));
  inside(agentsRoot, temporary);
  try {
    const hooks = join(temporary, 'empty-hooks');
    mkdirSync(hooks);
    const repositories = new Map();
    for (const skill of missing) {
      const key = `${skill.repository}@${skill.commit}`;
      if (!repositories.has(key)) {
        const checkout = join(temporary, `source-${repositories.size}`);
        mkdirSync(checkout);
        console.log(`下载官方来源：${key}`);
        git(checkout, hooks, ['init', '--quiet', `--template=${hooks}`]);
        git(checkout, hooks, [
          'remote',
          'add',
          'origin',
          `https://github.com/${skill.repository}.git`,
        ]);
        git(checkout, hooks, [
          'fetch',
          '--quiet',
          '--depth=1',
          '--filter=blob:none',
          'origin',
          skill.commit,
        ]);
        const paths = missing
          .filter((item) => `${item.repository}@${item.commit}` === key)
          .map((item) => item.path);
        git(checkout, hooks, ['sparse-checkout', 'set', ...paths]);
        git(checkout, hooks, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
        repositories.set(key, checkout);
      }
      const checkout = repositories.get(key);
      const staged = join(temporary, skill.name);
      cpSync(join(checkout, skill.path), staged, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      });
      for (const [destination, source] of Object.entries(skill.extraFiles ?? {})) {
        const target = inside(staged, resolve(staged, destination));
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(checkout, source), target, { errorOnExist: true, force: false });
      }
      verifySkill(skill, staged);
    }
    // 所有新文件均通过校验后再发布；任何已有 Skill 都不被覆盖。
    for (const skill of missing) {
      const destination = inside(skillsRoot, join(skillsRoot, skill.name));
      if (existsSync(destination))
        throw new Error(`安装期间目录已出现，请重新校验：${destination}`);
      renameSync(inside(temporary, join(temporary, skill.name)), destination);
      console.log(`已安装：${skill.name}`);
    }
  } finally {
    inside(agentsRoot, temporary);
    rmSync(temporary, { recursive: true, force: true });
  }
}
