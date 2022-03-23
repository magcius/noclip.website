
const webpack = require('webpack');
const { merge } = require('webpack-merge');
const path = require('path');
const common = require('./webpack.common.js');
const WasmPackPlugin = require("@wasm-tool/wasm-pack-plugin");

module.exports = merge(common, {
  mode: 'production',
  devtool: false,
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    new WasmPackPlugin({
      crateDirectory: path.join(__dirname, 'rust'),
      forceMode: "production",
    }),
  ],
});
