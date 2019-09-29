import typescript from 'rollup-plugin-typescript2';
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';
import json from 'rollup-plugin-json';

import path from 'path';

const sourcePath = path.join(__dirname, 'src', 'index.ts');
const libraryPath = path.join(__dirname, 'lib', 'index.js');

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'lib/index.js',
      format: 'cjs',
      sourcemap: true
    }
  ],
  plugins: [
    json(),
    resolve(),
    commonjs(),
    typescript({
      rollupCommonJSResolveHack: true,
      useTsconfigDeclarationDir: false,
      target: 'es6',
      tsconfigOverride: {
        outDir: 'lib',
        rootDir: 'src',
        include: ['src'],
        declaration: true,
        strict: true
      }
    }),
  ],
  watch: {
    chokidar: false,
    exclude: ['lib']
  },
  external: ['axios', 'fs', 'path']
}