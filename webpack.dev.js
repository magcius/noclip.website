
const webpack = require('webpack');
const path = require('path');
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const WasmPackPlugin = require("@wasm-tool/wasm-pack-plugin");
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'eval-cheap-module-source-map',
  cache: {
    type: 'filesystem',
  },
  devServer: {
    static: {
      directory: path.join(__dirname, `data`),
      publicPath: `/data/`,
      watch: false,
    },
    compress: true,
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          // Run ts-loader in parallel, leaving one CPU for checker
          {
            loader: 'thread-loader',
            options: {
              workers: require('os').cpus().length - 1,
              poolTimeout: Infinity, // set to Infinity in watch mode
            },
          },
          {
            loader: 'ts-loader',
            options: {
              happyPackMode: true,
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development'),
    }),
    new ForkTsCheckerWebpackPlugin(),
    new WasmPackPlugin({
      crateDirectory: path.join(__dirname, 'rust'),
      forceMode: "production",
      extraArgs: "--profiling",
    }),
  ],
});
