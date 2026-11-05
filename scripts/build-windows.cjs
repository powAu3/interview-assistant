// Bundle the tested Python environment alongside Electron. Speech models are downloaded by the app.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.packaging', 'windows');
const python = path.join(root, '.venv', 'Scripts', 'python.exe');
const desktop = path.join(root, 'desktop');
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ||= '7';

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Build this package on Windows x64.');
}
if (!fs.existsSync(python)) {
  throw new Error('Create .venv with Python 3.11 and install backend dependencies, soundcard, funasr, torch and torchaudio first.');
}
const runtime = JSON.parse(execFileSync(python, ['-c',
  'import json, sys, struct; print(json.dumps({"base": sys.base_prefix, "version": list(sys.version_info[:2]), "bits": struct.calcsize("P") * 8}))',
], { encoding: 'utf8' }));
if (runtime.bits !== 64 || runtime.version.join('.') !== '3.11') {
  throw new Error('The bundled runtime must be Python 3.11 x64.');
}
run(python, ['-c', 'import importlib.util; modules = ["uvicorn", "soundcard", "torch", "torchaudio", "faster_whisper", "funasr"]; assert all(importlib.util.find_spec(m) for m in modules), "Missing runtime dependency"; print("Python dependencies found")']);
run(process.execPath, [path.join(root, 'frontend', 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], path.join(root, 'frontend'));
run(process.execPath, [path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], path.join(root, 'frontend'));

// This path is fixed inside the repository and contains only generated staging files.
if (path.dirname(stage) !== path.join(root, '.packaging')) throw new Error('Unexpected staging path.');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const copyOptions = {
  recursive: true,
  dereference: true,
  filter: (source) => {
    const topLevel = path.relative(runtime.base, source).split(path.sep)[0];
    if (['include', 'libs'].includes(topLevel)) return false;
    return !['__pycache__', '_virtualenv.pth', '_virtualenv.py', 'site-packages'].includes(path.basename(source));
  },
};
console.log('Copying standalone Python interpreter...');
fs.cpSync(runtime.base, path.join(stage, 'python'), copyOptions);
console.log('Copying Python dependencies...');
const sitePackages = path.join(root, '.venv', 'Lib', 'site-packages');
fs.cpSync(sitePackages, path.join(stage, 'python', 'Lib', 'site-packages'), {
  recursive: true,
  dereference: true,
  filter: (source) => {
    if (['__pycache__', '_virtualenv.pth', '_virtualenv.py'].includes(path.basename(source))) return false;
    const relative = path.relative(sitePackages, source);
    const parts = relative.split(path.sep);
    if (parts[0] === 'torch' && ['include', 'share'].includes(parts[1])) return false;
    if (relative === path.join('torch', 'bin', 'protoc.exe')) return false;
    if (['numpy', 'scipy', 'sklearn'].includes(parts[0]) && parts.includes('tests')) return false;
    // Inference uses the DLLs; these import/static libraries are for compiling C++ extensions.
    return !(relative.startsWith(`torch${path.sep}lib${path.sep}`) && source.toLowerCase().endsWith('.lib'));
  },
});
// llvmlite distributes the matching Microsoft C++ runtime under a wheel-specific filename.
// Torch needs its canonical name beside python.exe on machines without the VC++ redistributable.
const llvmLibraries = path.join(stage, 'python', 'Lib', 'site-packages', 'llvmlite.libs');
const cppRuntime = fs.readdirSync(llvmLibraries).find((name) => /^msvcp140-[a-f0-9]+\.dll$/i.test(name));
if (!cppRuntime) throw new Error('The llvmlite wheel is missing its Microsoft C++ runtime.');
fs.copyFileSync(path.join(llvmLibraries, cppRuntime), path.join(stage, 'python', 'msvcp140.dll'));

// Only tracked backend files enter the release. Local keys, databases, logs and model caches stay outside it.
const files = execFileSync('git', ['ls-files', '-z', '--', 'backend'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of files) {
  if (path.basename(file) === '.gitkeep') continue;
  if (file.startsWith('backend/tests/') || file.startsWith('backend/scripts/')) continue;
  if (file !== 'backend/config.example.json' && /(?:^|\/)(?:data|__pycache__|config\.json|user_config\.json)(?:\/|$)|\.db(?:-|$)/.test(file)) {
    throw new Error(`Refusing to package runtime data: ${file}`);
  }
  const destination = path.join(stage, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file), destination);
}
const configPath = path.join(stage, 'backend', 'config.example.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.models = [];
config.whisper_preload = false;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
const requirements = execFileSync(python, ['-c',
  'import importlib.metadata as m; print("\\n".join(sorted(d.metadata["Name"] + "==" + d.version for d in m.distributions())))',
], { encoding: 'utf8' });
fs.writeFileSync(path.join(stage, 'runtime-requirements.txt'), requirements);

run(process.execPath, [
  path.join(desktop, 'node_modules', 'electron-builder', 'cli.js'),
  ...(process.argv.includes('--dir') ? ['--dir', '--win', '--x64'] : ['--win', 'nsis', '--x64']),
  '--publish', 'never',
], desktop);
