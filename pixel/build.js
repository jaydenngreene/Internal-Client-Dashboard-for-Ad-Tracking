const esbuild = require('esbuild')
const fs = require('fs')
const path = require('path')

const isWatch = process.argv.includes('--watch')

const buildOptions = {
  entryPoints: ['src/pixel.js'],
  bundle: false,
  minify: !isWatch,
  outfile: 'dist/pixel.js',
}

if (isWatch) {
  esbuild.context(buildOptions).then((ctx) => ctx.watch())
} else {
  esbuild.build(buildOptions).then(() => {
    console.log('Pixel built → dist/pixel.js')
  })
}
