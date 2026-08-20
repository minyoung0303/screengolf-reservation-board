import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** Electron 메인 프로세스와 서버 코드를 하나로 묶는다. 런타임 의존성 없이 dist 만으로 동작한다. */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  tsconfig: 'tsconfig.node.json',
  external: ['electron'],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

const targets = [
  { entryPoints: ['electron/main.ts'], outfile: 'dist/main/main.js' },
  { entryPoints: ['electron/preload.ts'], outfile: 'dist/main/preload.js' },
  { entryPoints: ['server/standalone.ts'], outfile: 'dist/main/standalone.js' },
];

if (watch) {
  const contexts = await Promise.all(targets.map((t) => esbuild.context({ ...common, ...t })));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[build-node] 변경 감시 중...');
} else {
  await Promise.all(targets.map((t) => esbuild.build({ ...common, ...t })));
}
