import * as rspack from '@rspack/core';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import { GitRevisionPlugin } from 'git-revision-webpack-plugin';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';

// Target browsers, see: https://github.com/browserslist/browserslist
const targets = ["chrome >= 87", "edge >= 88", "firefox >= 78", "safari >= 14"];
const gitRevision = new GitRevisionPlugin();

const config: rspack.Configuration = {
  context: __dirname,
  entry: {
    main: './src/main.ts',
  },
  output: {
    path: __dirname + '/dist',
    filename: '[name]-[contenthash].js',
  },
  target: 'web',
  // Disable asset size limit warnings
  performance: false,
  resolve: {
    extensionAlias: {
      '.js': ['.js', '.ts'],
    },
  },
  module: {
    rules: [
      {
        test: /\.(png|woff2)$/,
        type: 'asset/resource',
      },
      {
        test: /\.glsl$/,
        type: 'asset/source',
      },
      {
        test: /\.(j|t)s$/,
        exclude: [/[\\/]node_modules[\\/]/],
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: {
              syntax: 'typescript',
              decorators: true,
            },
            externalHelpers: true,
          },
          env: { targets },
        },
      },
    ],
  },
  plugins: [
    new rspack.DefinePlugin({
      '__COMMIT_HASH': JSON.stringify(gitRevision.commithash()),
    }),
    new rspack.IgnorePlugin({
      // Workaround for broken libraries
      resourceRegExp: /^(fs|path)$/,
    }),
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: [
        '**/*',
        '!data',
        '!data/**/*',
        '!.htaccess',
      ],
    }),
    new HtmlWebpackPlugin({
      chunks: ['main'],
      filename: 'index.html',
      template: './src/index.html',
    }),
    new HtmlWebpackPlugin({
      chunks: ['main'],
      filename: 'embed.html',
      template: './src/index.html',
    }),
    new rspack.CopyRspackPlugin({
      // All .wasm files are currently expected to be at the root
      patterns: [
        { from: 'src/**/*.wasm', to: '[name][ext]' },
        { from: 'node_modules/librw/lib/librw.wasm', to: '[name][ext]' },
      ],
    }),
    // Run type checking asynchronously
    new ForkTsCheckerWebpackPlugin(),
  ],
  devServer: {
    static: {
      directory: './data',
      publicPath: '/data/',
      watch: false,
    },
    compress: true,
  },
  optimization: {
    minimizer: [
      new rspack.SwcJsMinimizerRspackPlugin(),
      new rspack.LightningCssMinimizerRspackPlugin({
        minimizerOptions: { targets },
      })
    ]
  },
};

export default config;
