import { execSync } from 'node:child_process';

// The plugin publishes at ~105 kB tarball / ~445 kB unpacked. The server
// bundle must externalize its runtime imports (only `jiti` is a real
// dependency) - a dependency silently slipping into the vite bundle would
// blow past these ceilings long before it reaches npm.
const MAX_TARBALL_KB = 200;
const MAX_UNPACKED_KB = 900;
const LARGEST_FILES_SHOWN = 5;

const toKb = (bytes) => bytes / 1024;
const formatKb = (bytes) => `${toKb(bytes).toFixed(1)} kB`;

const [report] = JSON.parse(
  execSync('npm pack --dry-run --json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
);

const requiredPaths = ['dist/server/', 'dist/cli/'];
for (const prefix of requiredPaths) {
  if (!report.files.some((file) => file.path.startsWith(prefix))) {
    console.error(`[size-check] No ${prefix} files in the package - run \`npm run build\` first.`);
    process.exit(1);
  }
}

const failures = [];
if (toKb(report.size) > MAX_TARBALL_KB) {
  failures.push(`tarball ${formatKb(report.size)} exceeds ${MAX_TARBALL_KB} kB`);
}
if (toKb(report.unpackedSize) > MAX_UNPACKED_KB) {
  failures.push(`unpacked ${formatKb(report.unpackedSize)} exceeds ${MAX_UNPACKED_KB} kB`);
}

if (failures.length > 0) {
  console.error(`[size-check] FAILED: ${failures.join('; ')}`);
  console.error(
    '[size-check] A dependency is probably being bundled instead of externalized - ',
    'runtime imports must be declared in dependencies or peerDependencies.',
  );
  console.error('[size-check] Largest packed files:');
  for (const file of [...report.files]
    .sort((a, b) => b.size - a.size)
    .slice(0, LARGEST_FILES_SHOWN)) {
    console.error(`  ${formatKb(file.size).padStart(10)}  ${file.path}`);
  }
  process.exit(1);
}

console.log(
  `[size-check] OK: tarball ${formatKb(report.size)} (max ${MAX_TARBALL_KB} kB),`,
  `unpacked ${formatKb(report.unpackedSize)} (max ${MAX_UNPACKED_KB} kB)`,
);
