#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packageDir = path.resolve(__dirname, '..');
const distDir = path.join(packageDir, 'dist');
const packageJsonPath = path.join(packageDir, 'package.json');

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const binName = typeof pkg.bin === 'string'
  ? path.basename(pkg.bin, path.extname(pkg.bin))
  : Object.keys(pkg.bin || {})[0] || pkg.name.split('/').pop() || 'serial-agent-mcp';
const version = pkg.version;
const compiledEntryPath = path.join(distDir, 'index.js');
const compiledMapPath = path.join(distDir, 'index.js.map');
const versionedBaseName = `${binName}-${version}`;
const versionedEntryName = `${versionedBaseName}.js`;
const versionedMapName = `${versionedBaseName}.js.map`;
const versionedEntryPath = path.join(distDir, versionedEntryName);
const versionedMapPath = path.join(distDir, versionedMapName);
const compatibilityEntryPath = path.join(distDir, 'index.js');

if (!fs.existsSync(compiledEntryPath)) {
  throw new Error(`Expected compiled entry at ${compiledEntryPath}`);
}

for (const fileName of fs.readdirSync(distDir)) {
  if (/^serial-agent-mcp-.*\.js(\.map)?$/.test(fileName)) {
    fs.unlinkSync(path.join(distDir, fileName));
  }
}

let compiledSource = fs.readFileSync(compiledEntryPath, 'utf8');
if (compiledSource.includes('//# sourceMappingURL=index.js.map')) {
  compiledSource = compiledSource.replace(
    '//# sourceMappingURL=index.js.map',
    `//# sourceMappingURL=${versionedMapName}`,
  );
}
fs.writeFileSync(versionedEntryPath, compiledSource, 'utf8');

if (fs.existsSync(compiledMapPath)) {
  fs.copyFileSync(compiledMapPath, versionedMapPath);
  fs.unlinkSync(compiledMapPath);
}

const compatibilitySource = `#!/usr/bin/env node\n\nrequire('./${versionedEntryName}');\n`;
fs.writeFileSync(compatibilityEntryPath, compatibilitySource, 'utf8');
