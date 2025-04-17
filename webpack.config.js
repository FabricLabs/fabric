'use strict';

const webpack = require('webpack');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports = {
  entry: './index.js',
  // devtool: 'source-map',
  mode: 'development',
  target: 'web',
  output: {
    library: 'Fabric'
  },
  plugins: [
    new webpack.ProvidePlugin({
      Peer: ['peerjs', 'default']
    }),
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production'),
        APP_ENV: JSON.stringify('browser')
      }
    }),
    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE ? 'server' : 'disabled',
      openAnalyzer: true
    })
  ]
};
