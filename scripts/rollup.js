// rollup.config.js

import fs from 'fs';
import babel from 'rollup-plugin-babel';
import json from 'rollup-plugin-json';
import npm from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import uglify from 'rollup-plugin-uglify';

const nodeModules = [
  'fs', 'path', 'electron',
  'codemirror/mode/javascript/javascript',
  'codemirror/addon/comment/comment',
  'codemirror/addon/edit/closebrackets',
  'codemirror/addon/edit/matchbrackets',
  'codemirror/addon/selection/active-line',
  'codemirror/addon/dialog/dialog',
  'codemirror/addon/search/searchcursor',
  'codemirror/addon/search/search',
  'codemirror/keymap/sublime'
];

fs.readdirSync('node_modules').forEach(module => {
  if (module !== '.bin') {
    nodeModules.push(module);
  }
});

export default {
  entry: 'src/index.js',
  plugins: [
    json(),

    babel({
      babelrc: false,
      retainLines: true,
      compact: true,
      comments: false,
      // sourceMap: true,
      exclude: "node_modules/**",
      presets: ['es2015-rollup'],
      plugins: ['transform-object-rest-spread', 'transform-remove-console']
    }),

    // npm 모듈을`node_modules`에서로드
    npm({
      jsnext: false,
      main: true
    }),

    // CommonJS 모듈을 ES6로 변환
    commonjs({
      include: 'node_modules/**'
    }),

    uglify({
      compress: {
        warnings: false
      },
      mangle: {
        keep_fnames: true
      }
    })
  ],
  external: nodeModules,
  format: 'cjs',
  dest: 'dist/index.js',
  sourceMap: true
};
