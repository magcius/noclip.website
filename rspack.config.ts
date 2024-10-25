import * as rspack from '@rspack/core';
import * as fs from 'node:fs';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import { GitRevisionPlugin } from 'git-revision-webpack-plugin';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';

const targets = JSON.parse(fs.readFileSync(__dirname + '/package.json', 'utf8')).browserslist;
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
            transform: {
              useDefineForClassFields: false,
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
    new rspack.EnvironmentPlugin(['NODE_ENV']),
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
    ]
  },
};

export default config;
