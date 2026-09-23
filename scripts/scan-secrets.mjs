import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const patterns = [
  ['GitHub token', /(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,})/],
  ['API key', /\bsk-[A-Za-z0-9_-]{24,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const ignored = new Set(['.git', 'node_modules', 'dist', 'data', 'coverage', '.vite']);
const findings = [];
function inspect(line, source, lineNumber) {
  for (const [rule, regex] of patterns) {
    if (regex.test(line)) findings.push({ source, line: lineNumber, rule });
  }
}
async function scanDirectory(directory, label = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const relative = path.join(label, entry.name);
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await scanDirectory(target, relative);
    else if (entry.isFile()) {
      const bytes = await readFile(target);
      if (bytes.length > 1024 * 1024 || bytes.includes(0)) continue;
      const lines = bytes.toString('utf8').split(/\r?\n/);
      lines.forEach((line, index) => inspect(line, relative, index + 1));
    }
  }
}
await scanDirectory(process.cwd());
if (process.argv.includes('--history')) {
  const log = execFileSync('git', ['log', '--all', '-p', '--no-ext-diff',
    '--format=commit %H'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  let file = 'unknown', commit = 'unknown';
  log.split(/\r?\n/).forEach((line, index) => {
    if (line.startsWith('commit ')) commit = line.slice(7);
    else if (line.startsWith('diff --git a/')) file = line.slice(13).split(' b/')[0];
    else if (/^[+-](?![+-])/.test(line)) inspect(line, `${commit.slice(0, 12)}:${file}`, index + 1);
  });
}
if (findings.length) {
  for (const item of findings) console.error(`${item.source}:${item.line}: ${item.rule}`);
  console.error(`${findings.length} potential secret finding(s); no values printed.`);
  process.exitCode = 1;
} else console.log('No matching credential patterns in scanned files' +
  (process.argv.includes('--history') ? ' or Git patch history.' : '.'));
