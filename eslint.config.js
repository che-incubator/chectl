/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

const { FlatCompat } = require('@eslint/eslintrc')
const js = require('@eslint/js')
const tsParser = require('@typescript-eslint/parser')
const headerPlugin = require('eslint-plugin-header')

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
})

// Patch eslint-plugin-header to include a schema (required by ESLint 9)
const patchedHeaderPlugin = {
  ...headerPlugin,
  rules: {
    ...headerPlugin.rules,
    header: {
      ...headerPlugin.rules.header,
      meta: {
        ...headerPlugin.rules.header.meta,
        schema: [
          { type: 'string' },
          {
            anyOf: [
              { type: 'string' },
              { type: 'array' },
            ],
          },
          {
            type: 'object',
            properties: {},
            additionalProperties: true,
          },
        ],
      },
    },
  },
}

module.exports = [
  {
    ignores: ['**/node_modules/**', '**/lib/**'],
  },
  ...compat.extends(
    'oclif',
    'oclif-typescript',
  ).map(config => {
    // Remove rules that were removed in ESLint 9
    if (config.rules) {
      const removedRules = ['valid-jsdoc', 'comma-dangle', 'indent', 'quotes', 'semi', 'object-curly-spacing']
      for (const rule of removedRules) {
        delete config.rules[rule]
      }
    }
    // Remove legacy parser references that lack ESLint 9 meta property
    if (config.languageOptions && config.languageOptions.parser && !config.languageOptions.parser.meta) {
      delete config.languageOptions.parser
    }
    // Remove plugins incompatible with ESLint 9 (use context.getScope())
    const incompatiblePlugins = ['node', 'unicorn', 'mocha']
    if (config.plugins) {
      for (const plugin of incompatiblePlugins) {
        delete config.plugins[plugin]
      }
    }
    if (config.rules) {
      for (const key of Object.keys(config.rules)) {
        if (incompatiblePlugins.some(p => key.startsWith(`${p}/`))) {
          delete config.rules[key]
        }
      }
    }
    return config
  }),
  {
    files: ['{src,tests}/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: 'tsconfig.json',
        sourceType: 'module',
        ecmaVersion: 2015,
      },
    },
    plugins: {
      header: patchedHeaderPlugin,
      'no-null': require('eslint-plugin-no-null'),
    },
    rules: {
      // License header
      'header/header': [
        2,
        'block',
        [
          '*',
          {
            pattern: '^ \\* Copyright \\(c\\) \\d{4}(-\\d{4})* Red Hat, Inc\\.$',
            template: ' * Copyright (c) 2019-2021 Red Hat, Inc.',
          },
          ' * This program and the accompanying materials are made',
          ' * available under the terms of the Eclipse Public License 2.0',
          ' * which is available at https://www.eclipse.org/legal/epl-2.0/',
          ' *',
          ' * SPDX-License-Identifier: EPL-2.0',
          ' *',
          ' * Contributors:',
          ' *   Red Hat, Inc. - initial API and implementation',
          ' ',
        ],
      ],

      // Disabled rules
      'no-use-before-define': 0,
      camelcase: 0,
      'no-await-in-loop': 0,
      'no-mixed-operators': 0,
      'max-statements-per-line': 0,
      'no-negated-condition': 0,
      'new-cap': 0,
      'require-atomic-updates': 0,
      '@typescript-eslint/no-empty-function': 0,
      'no-useless-escape': 0,
      '@typescript-eslint/explicit-module-boundary-types': 0,
      'no-inner-declarations': 0,
      '@typescript-eslint/ban-types': 0,
      '@typescript-eslint/no-require-imports': 0,
      '@typescript-eslint/no-empty-object-type': 0,
      '@typescript-eslint/no-unused-expressions': 0,
      'no-multi-assign': 0,
      'no-lonely-if': 0,
      'no-async-promise-executor': 0,
      'prefer-promise-reject-errors': 0,
      'no-else-return': 0,
      'no-useless-return': 0,
      'no-case-declarations': 0,
      'lines-between-class-members': 0,
      'max-params': 0,
      complexity: 0,
    },
  },
]
