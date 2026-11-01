import { readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { root } from './runtime.mjs';

const failures = [];
const forbiddenClient = [
  '@personamarket/database',
  '@personamarket/server',
  'pg',
  'redis',
  'ioredis',
  'bullmq',
];
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.next'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : /\.[cm]?tsx?$/.test(entry.name) ? [path] : [];
  });
}
for (const group of ['apps', 'packages']) {
  for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, group, entry.name);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };
    for (const file of walk(directory)) {
      const source = readFileSync(file, 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const client =
        (group === 'apps' && entry.name === 'web') || ['ui', 'api-client'].includes(entry.name);
      function report(message) {
        failures.push(`${relative(root, file)}: ${message}`);
      }
      function inspect(specifier, typeOnly = false) {
        if (specifier.startsWith('@/') && group === 'apps' && entry.name === 'web') {
          const target = relative(directory, resolve(directory, 'src', specifier.slice(2)));
          if (target.startsWith(`..${sep}`) || isAbsolute(target)) report('本地 alias 路径越界。');
          return;
        }
        if (specifier.startsWith('.')) {
          const target = relative(directory, resolve(dirname(file), specifier));
          if (target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target))
            report('禁止跨包相对路径导入。');
          return;
        }
        const name = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0];
        const builtin = specifier.startsWith('node:') || builtinModules.includes(specifier);
        const typesName = `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;
        if (
          !builtin &&
          name !== manifest.name &&
          !declared[name] &&
          !(typeOnly && declared[typesName])
        )
          report(`未声明的依赖：${name}`);
        if (client && forbiddenClient.includes(name)) report(`浏览器包不能导入服务端依赖：${name}`);
        if (
          group === 'packages' &&
          specifier.startsWith('@personamarket/') &&
          ['api', 'worker', 'web'].includes(name.split('/')[1])
        )
          report('共享包不能导入应用。');
        if (entry.name === 'contracts' && (builtin || specifier.startsWith('@personamarket/')))
          report('契约包必须保持独立纯函数。');
      }
      function visit(node) {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          inspect(
            node.moduleSpecifier.text,
            ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly,
          );
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        ) {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteral(argument)) inspect(argument.text);
          else report('动态导入必须使用可审查的静态路径。');
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
      if (
        client &&
        /DATABASE_URL|MIGRATION_DATABASE_URL|REDIS_URL|APP_ENCRYPTION_KEY|STATS_HMAC_KEY/.test(
          source,
        )
      )
        report('Web / UI / 客户端不能读取服务端秘密环境变量。');
    }
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('依赖声明、包边界与浏览器秘密边界检查通过。');
