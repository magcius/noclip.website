const webpack = require('webpack');
const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const HardSourceWebpackPlugin = require('hard-source-webpack-plugin');
const HappyPack = require('happypack');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'cheap-eval-source-map',
  devServer: {
    contentBase: './dist',
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'happypack/loader?id=ts',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development'),
    }),
    // Cache intermediate results
    new HardSourceWebpackPlugin(),
    // Run ts-loader in parallel, leaving one CPU for checker
    new HappyPack({
      id: 'ts',
      threads: require('os').cpus().length - 1,
      use: [
        {
          path: 'ts-loader',
          query: {
            happyPackMode: true,
          },
        },
      ],
    }),
    // Run ts checker asynchronously
    new ForkTsCheckerWebpackPlugin({
      checkSyntacticErrors: true,
    }),
  ],
});
