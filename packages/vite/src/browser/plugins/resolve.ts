import path from 'path'
import type { Plugin } from '../../node/plugin'
import chalk from 'chalk'
import {
  FS_PREFIX,
  DEFAULT_EXTENSIONS,
} from '../../node/constants'
import {
  createDebugger,
  isExternalUrl,
  fsPathFromId,
  isDataUrl,
} from '../../node/utils'
import type { ViteDevServer, InternalResolveOptions } from '../../node'
import type { PartialResolvedId } from 'rollup'
import { resolve as _resolveExports } from 'resolve.exports'
import fs from 'fs';

const isDebug = process.env.DEBUG
const debug = createDebugger('vite:resolve-details', {
  onlyWhenFocused: true
})

export function resolvePlugin(baseOptions: InternalResolveOptions): Plugin {
  const {
    root,
    asSrc,
    preferRelative = false
  } = baseOptions
  const requireOptions: InternalResolveOptions = {
    ...baseOptions,
    isRequire: true
  }
  return {
    name: 'vite:browser:resolve',

    resolveId(id, importer, resolveOpts, ssr) {
      // this is passed by @rollup/plugin-commonjs
      const isRequire =
        resolveOpts &&
        resolveOpts.custom &&
        resolveOpts.custom['node-resolve'] &&
        resolveOpts.custom['node-resolve'].isRequire

      const options = isRequire ? requireOptions : baseOptions

      let res: string | PartialResolvedId | undefined

      // explicit fs paths that starts with /@fs/*
      if (asSrc && id.startsWith(FS_PREFIX)) {
        const fsPath = fsPathFromId(id)
        res = tryFsResolve(fsPath, options)
        isDebug && debug(`[@fs] ${chalk.cyan(id)} -> ${chalk.dim(res)}`)
        // always return here even if res doesn't exist since /@fs/ is explicit
        // if the file doesn't exist it should be a 404
        return res || fsPath
      }

      // URL
      // /foo -> /fs-root/foo
      if (asSrc && id.startsWith('/')) {
        const fsPath = path.resolve(root, id.slice(1))
        if ((res = tryFsResolve(fsPath, options))) {
          isDebug && debug(`[url] ${chalk.cyan(id)} -> ${chalk.dim(res)}`)
          return res
        }
      }

      // relative
      if (id.startsWith('.') || (preferRelative && /^\w/.test(id))) {
        const basedir = importer ? path.dirname(importer) : process.cwd()
        const fsPath = path.resolve(basedir, id)
        // handle browser field mapping for relative imports

        if ((res = tryFsResolve(fsPath, options))) {
          return res;
        }
      }

      // absolute fs paths
      if (path.isAbsolute(id) && (res = tryFsResolve(id, options))) {
        isDebug && debug(`[fs] ${chalk.cyan(id)} -> ${chalk.dim(res)}`)
        return res
      }

      // external
      if (isExternalUrl(id)) {
        return {
          id,
          external: true
        }
      }

      // data uri: pass through (this only happens during build and will be
      // handled by dedicated plugin)
      if (isDataUrl(id)) {
        return null
      }

      isDebug && debug(`[fallthrough] ${chalk.dim(id)}`)
    }
  }
}

function tryFsResolve(
  fsPath: string,
  options: InternalResolveOptions,
  tryIndex = true,
  targetWeb = true
): string | undefined {
  let file = fsPath
  let postfix = ''

  let postfixIndex = fsPath.indexOf('?')
  if (postfixIndex < 0) {
    postfixIndex = fsPath.indexOf('#')
  }
  if (postfixIndex > 0) {
    file = fsPath.slice(0, postfixIndex)
    postfix = fsPath.slice(postfixIndex)
  }

  let res: string | undefined
  if (
    (res = tryResolveFile(
      file,
      postfix,
      options,
      false,
      targetWeb,
      options.tryPrefix,
      options.skipPackageJson
    ))
  ) {
    return res
  }

  for (const ext of options.extensions || DEFAULT_EXTENSIONS) {
    if (
      (res = tryResolveFile(
        file + ext,
        postfix,
        options,
        false,
        targetWeb,
        options.tryPrefix,
        options.skipPackageJson
      ))
    ) {
      return res
    }
  }

  if (
    (res = tryResolveFile(
      file,
      postfix,
      options,
      tryIndex,
      targetWeb,
      options.tryPrefix,
      options.skipPackageJson
    ))
  ) {
    return res
  }
}

function tryResolveFile(
  file: string,
  postfix: string,
  options: InternalResolveOptions,
  tryIndex: boolean,
  targetWeb: boolean,
  tryPrefix?: string,
  skipPackageJson?: boolean
): string | undefined {
  if (!file.startsWith(options.root)) return undefined;
  if (fs.existsSync(file)) {
    return file + postfix
  } else if (tryIndex) {
    const index = tryFsResolve(file + '/index', options, false)
    if (index) return index + postfix
  }
  if (tryPrefix) {
    const prefixed = `${path.dirname(file)}/${tryPrefix}${path.basename(file)}`
    return tryResolveFile(prefixed, postfix, options, tryIndex, targetWeb)
  }
}

export function tryOptimizedResolve(
  id: string,
  server: ViteDevServer,
  importer?: string
): string | undefined {
  const cacheDir = server.config.cacheDir
  const depData = server._optimizeDepsMetadata

  if (!cacheDir || !depData) return

  const getOptimizedUrl = (optimizedData: typeof depData.optimized[string]) => {
    return (
      optimizedData.file //+
      // `?v=${depData.browserHash}${
      //   optimizedData.needsInterop ? `&es-interop` : ``
      // }`
    )
  }

  // check if id has been optimized
  const isOptimized = depData.optimized[id]
  if (isOptimized) {
    return getOptimizedUrl(isOptimized)
  }

  if (!importer) return
}
