/**
 * Serial Agent VSIX 打包脚本
 *
 * 原因：npm workspace 环境中，vsce 通过 npm list 解析 symlink 导致文件重复冲突。
 * 解决方案：把扩展目录复制到 workspace 外的临时目录，独立安装依赖，再打包。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const srcDir = __dirname;
const tmpDir = path.join(os.tmpdir(), 'serialagent-vscode-pack');
const vsixVersion = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8')).version;
const vsixName = `serialagent-vscode-${vsixVersion}.vsix`;
const vsixOut = path.join(srcDir, vsixName);

const exec = (cmd, cwd) => {
  console.log(`  > ${cmd}`);
  execSync(cmd, { cwd: cwd || tmpDir, stdio: 'inherit' });
};

// [1] 清理并创建临时目录
console.log('[1/5] Preparing temp dir...');
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

// [2] 复制必要文件（不含 node_modules、dist）
console.log('[2/5] Copying source files...');
const copyItems = ['src', 'media', 'package.json', '.vscodeignore', 'webpack.config.js', 'README.md'];
for (const item of copyItems) {
  const src = path.join(srcDir, item);
  const dst = path.join(tmpDir, item);
  if (!fs.existsSync(src)) continue;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    copyDir(src, dst);
  } else {
    fs.copyFileSync(src, dst);
  }
}

// 写入独立 tsconfig.json（不继承 workspace 根目录）
fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2020',
    module: 'commonjs',
    lib: ['ES2020'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    declaration: false,
    sourceMap: false,
    outDir: './dist',
    rootDir: './src',
  },
  include: ['src/**/*'],
}, null, 2));

// [3] 安装全部依赖（含 devDependencies，用于编译 TS）
console.log('[3/5] Installing all dependencies (standalone, no workspace)...');
exec('npm install --no-package-lock', tmpDir);

// [4] 用 webpack 打包（将 serialport 纯 JS 内联进 extension.js，只 externalize 含 .node 的 bindings-cpp）
console.log('[4/5] Building with webpack...');
exec('npm exec -- webpack --config webpack.config.js', tmpDir);

// [5] 打包 VSIX
console.log('[5/5] Packaging VSIX...');
exec(`npx @vscode/vsce package --skip-license --out "${vsixOut}"`, tmpDir);

// 清理
console.log('\nCleaning up...');
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n✓ Done: ${vsixOut}`);

// 工具函数：递归复制目录
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}
