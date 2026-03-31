const path = require('path');
const {merge} = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    port: 8081,
    liveReload: true,
    hot: true,
    open: false,
    static: {
      directory: './',
      watch: {
        ignored: [
          path.resolve(__dirname, 'Testoutput'),
          path.resolve(__dirname, 'node_modules'),
          path.resolve(__dirname, 'TestDocs')
        ]
      }
    },
    client: { overlay: false },
    proxy: [
      {
        context: ['/api'],
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
        pathRewrite: {
          '^/api': '' // removes /api prefix when forwarding
        },
        logLevel: 'debug'
      }
    ]
  }
});
