// @ts-check

import process from 'node:process'
import path from 'node:path'
import fs from 'node:fs/promises'
import minimist from 'minimist'
import * as babel from '@babel/core'
import { pinyin } from 'pinyin-pro'

const regexp = /[\u4e00-\u9fa5]+/

/**
 * @typedef {Object} Options cli options
 * @property {string} input input file path, could be a relative path to process exec working dictionary, default to `${process.cwd()}index.js`
 * @property {string} output output file path, could be a relative path to process exec working dictionary, default to `${process.cwd()}${input.filename}.cache.${input.fileext}`
 */

/**
 * the main exec process
 * @param {Options} options script passing options
 * @returns {Promise<void>} none
 */
export async function exec(options) {
  try {
    const argv = minimist(process.argv.slice(2), { string: ['_'] })

    const resolvedOptions = resolveOptions(options, argv)

    const file = await fs.readFile(resolvedOptions.input, {
      encoding: 'utf-8',
    })
    const code = file.toString()

    const result = await transform(code)

    if (result == null) {
      return
    }

    await fs.writeFile(resolvedOptions.output, result, {
      encoding: 'utf-8',
    })
  } catch (error) {
    console.error(error)
  }
}

/**
 * transform input code to output code with chinese string replaced
 * @param {string} input untransformed code
 * @returns {Promise<string | null>} transformed code
 */
export async function transform(input) {
  const ast = await babel.parseAsync(input, {
    plugins: ['@babel/plugin-syntax-jsx'],
    sourceType: 'module',
  })

  if (ast == null) {
    return null
  }

  babel.traverse(ast, {
    StringLiteral: (path) => {
      if (regexp.test(path.node.value)) {
        path.replaceWith(
          babel.types.callExpression(
            babel.types.identifier('i18n'),
            [babel.types.stringLiteral(generateKey(path.node.value))],
          )
        )
      }
    },
    ObjectProperty: (path) => {
      if (babel.types.isStringLiteral(path.node.key) && regexp.test(path.node.key.value)) {
        path.node.key = babel.types.arrayExpression([
          babel.types.callExpression(
            babel.types.identifier('i18n'),
            [babel.types.stringLiteral(generateKey(path.node.key.value))],
          )
        ])
      }
    },
    TemplateLiteral: (path) => {
      for (const node of [...(path.node.quasis)]) {
        if (regexp.test(node.value.cooked ?? node.value.raw)) {
          const index = path.node.quasis.indexOf(node)
          path.node.quasis.splice(
            index,
            1,
            babel.types.templateElement({ raw: '', cooked: '' }, false),
            babel.types.templateElement({ raw: '', cooked: '' }, index === path.node.quasis.length - 1),
          )
          path.node.expressions.splice(
            index,
            0,
            babel.types.callExpression(
              babel.types.identifier('i18n'),
              [babel.types.stringLiteral(generateKey(node.value.cooked ?? node.value.raw))],
            ),
          )
        }
      }
    },
    JSXAttribute: (path) => {
      if (babel.types.isStringLiteral(path.node.value) && regexp.test(path.node.value.value)) {
        path.node.value = babel.types.jsxExpressionContainer(
          babel.types.callExpression(
            babel.types.identifier('i18n'),
            [babel.types.stringLiteral(generateKey(path.node.value.value))],
          )
        )
      }
    },
    JSXText: (path) => {
      if (regexp.test(path.node.value)) {
        path.replaceWith(
          babel.types.jsxExpressionContainer(
            babel.types.callExpression(
              babel.types.identifier('i18n'),
              [babel.types.stringLiteral(generateKey(path.node.value))],
            )
          )
        )
      }
    },
  })

  const result = await babel.transformFromAstAsync(ast, undefined, {
    plugins: ['@babel/plugin-syntax-jsx'],
    sourceType: 'module',
  })

  if (result == null || result.code == null) {
    return null
  }

  return result.code
}

/**
 * generate i18n key from chinese string
 * @param {string} chinese chinese string
 * @returns {string} i18n key
 */
export function generateKey(chinese) {
  const py = pinyin(chinese, { toneType: 'none', type: 'array' })
  if (py.length >= 16) {
    return py.map(v => v.slice(0, 1)).join('')
  }
  if (py.length >= 8) {
    return py.map(v => v.slice(0, 2)).join('')
  }
  if (py.length >= 4) {
    return py.map(v => v.slice(0, 4)).join('')
  }
  return py.join('')
}

/**
 * resolve options and arguments
 * @param {Options} options options passing via code
 * @param {minimist.ParsedArgs & Partial<Record<'input' | 'i' | 'output' | 'o', string>>} args options passing via cli
 * @returns {Options} resolved options
 */
export function resolveOptions(options, args) {
  const cwd = process.cwd()

  const ops = Object.assign({}, options)
  ops.input = args.input ?? args.i ?? args._.at(0) ?? ops.input ?? 'index.js'
  ops.output = args.output ?? args.o ?? args._.at(1) ?? ops.output ?? null

  if (!path.isAbsolute(ops.input)) {
    ops.input = path.resolve(cwd, ops.input)
  }
  if (ops.output == null) {
    const ip = path.parse(ops.input)
    ops.output = path.resolve(ip.dir, `${ip.name}.cache${ip.ext}`)
  }
  if (!path.isAbsolute(ops.output)) {
    ops.output = path.resolve(cwd, ops.output)
  }

  return ops
}
