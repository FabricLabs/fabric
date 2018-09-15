'use strict';

const webpack = require('webpack');

module.exports = {
  // entry: './index.js',
  // devtool: 'source-map',
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production'),
        APP_ENV: JSON.stringify('browser')
      }
    })
  ]
};
