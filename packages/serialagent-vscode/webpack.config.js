/**
 * Serial Agent VS Code 扩展 Webpack 配置
 *
 * 关键设计决策：
 * - serialport 是原生 Node.js 模块（含 .node 二进制），必须从文件系统加载
 * - node-loader 会将 .node 内联为 base64，VS Code extension host 无法通过 require 加载
 * - 因此将 serialport 及其所有子包标记为 externals，由运行时从 node_modules 加载
 * - 扩展目录下保留独立的 node_modules/serialport，由 .vscodeignore 控制打包内容
 */

'use strict';

const path = require('path');

/** @type {import('webpack').Configuration} */
const config = {
  target: 'node',
  mode: 'none',

  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]',
  },

  devtool: 'source-map',

  externals: {
    // VS Code 运行时提供
    vscode: 'commonjs vscode',

    // @serialport/bindings-cpp 包含原生 .node 二进制文件（prebuilds/）
    // 必须从 node_modules 文件系统加载，不能被 webpack 打包
    // 其他纯 JS 的 serialport 包由 webpack 正常打包
    '@serialport/bindings-cpp': 'commonjs @serialport/bindings-cpp',
    'node-gyp-build': 'commonjs node-gyp-build',
  },

  resolve: {
    extensions: ['.ts', '.js'],
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }],
      },
    ],
  },
};

module.exports = config;
