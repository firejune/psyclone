'use strict';

const fs = require('fs');
const webpack = require('webpack');

const nodeModules = {};
fs.readdirSync('node_modules').forEach(module => {
  if (module !== '.bin') {
    nodeModules[module] = true;
  }
});

const nodeModulesTransform = function(context, request, callback) {
  // search for a '/' indicating a nested module
  const slashIndex = request.indexOf('/');
  let rootModuleName;
  if (slashIndex === -1) {
    rootModuleName = request;
  } else {
    rootModuleName = request.substr(0, slashIndex);
  }

  // Match for root modules that are in our node_modules
  if (nodeModules.hasOwnProperty(rootModuleName)) {
    callback(null, `commonjs ${request}`);
  } else {
    callback();
  }
};

nodeModules.electron = 'commonjs electron';

module.exports = {
  entry: {
    main: './app/index.js',
    render: './src/index.js'
  },

  target: 'node',

  output: {
    path: './dist',
    filename: '[name].js',
    publicPath: '/'
  },

  devtool: 'source-map',

  module: {
    loaders: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        loader: 'babel',
        query: {
          babelrc: false,
          retainLines: true,
          compact: true,
          comments: false,
          presets: [
            'es2015'
          ],
          plugins: [
            'transform-object-rest-spread',
            'transform-remove-console',
            'transform-runtime'
          ]
        }
      },
      {
        test: /\.(json)$/,
        loader: 'json'
      }
    ]
  },

  externals: nodeModulesTransform,

  resolve: {
    extensions: ['', '.js', '.json', 'jsx']
  },

  plugins: [
    new webpack.DefinePlugin({
      'process.env': {NODE_ENV: '"production"'}
    }),

    new webpack.optimize.UglifyJsPlugin({
      // sourceMap: true,
      compress: {
        warnings: false
      },
      mangle: {
        keep_fnames: true
      }
    }),

    new webpack.optimize.OccurenceOrderPlugin()
  ]
};
