require('isomorphic-fetch')
const fs = require('fs')
const path = require('path')
const tmpdir = require('os-tmpdir')
const gunzip = require('gunzip-maybe')
const mkdirp = require('mkdirp')
const tar = require('tar-fs')
const createMutex = require('./createMutex')

const PackageCacheDir = process.env.NPM_PACKAGE_CACHE_DIR || tmpdir() 

function createTempPath(name, version) {
  const normalName = name.replace(/\//g, '-')
  return path.join(PackageCacheDir, `unpkg-${normalName}-${version}`)
}

function stripNamePrefix(headers) {
  // Most packages have header names that look like "package/index.js"
  // so we shorten that to just "index.js" here. A few packages use a
  // prefix other than "package/". e.g. the firebase package uses the
  // "firebase_npm/" prefix. So we just strip the first dir name.
  headers.name = headers.name.replace(/^[^\/]+\//, '')
  return headers
}

function ignoreSymlinks(file, headers) {
  return headers.type === 'link'
}

function extractResponse(response, outputDir) {
  return new Promise(function (resolve, reject) {
    const extract = tar.extract(outputDir, {
      readable: true, // All dirs/files should be readable.
      map: stripNamePrefix,
      ignore: ignoreSymlinks
    })

    response.body
      .pipe(gunzip())
      .pipe(extract)
      .on('finish', resolve)
      .on('error', reject)
  })
}

function fetchAndExtract(tarballURL, outputDir) {
  console.log(`info: Fetching ${tarballURL} and extracting to ${outputDir}`)

  return fetch(tarballURL).then(function (response) {
    return extractResponse(response, outputDir)
  })
}

const fetchMutex = createMutex(function (payload, callback) {
  const { tarballURL, outputDir } = payload

  fs.access(outputDir, function (error) {
    if (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        // ENOENT or ENOTDIR are to be expected when we haven't yet
        // fetched a package for the first time. Carry on!
        mkdirp(outputDir, function (error) {
          if (error) {
            callback(error)
          } else {
            fetchAndExtract(tarballURL, outputDir).then(function () {
              callback()
            }, callback)
          }
        })
      } else {
        callback(error)
      }
    } else {
      // Best case: we already have this package cached on disk!
      callback()
    }
  })
})

function getPackage(packageConfig, callback) {
  const tarballURL = packageConfig.dist.tarball
  const outputDir = createTempPath(packageConfig.name, packageConfig.version)

  fetchMutex(tarballURL, { tarballURL, outputDir }, function (error) {
    callback(error, outputDir)
  })
}

module.exports = getPackage
