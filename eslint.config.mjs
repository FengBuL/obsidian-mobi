import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'eslint/config'
import obsidianmd from 'eslint-plugin-obsidianmd'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    ignores: [
      `dist/**`,
      `export/**`,
      `assets/**`,
      `scripts/**`,
      `third_party/**`,
      `node_modules/**`,
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [`eslint.config.mjs`],
        },
        tsconfigRootDir: root,
      },
    },
    rules: {
      // 设置与命令文案是中文产品文案，不按英文 sentence case 检查
      'obsidianmd/ui/sentence-case': `off`,
      'obsidianmd/commands/no-command-in-command-name': `off`,
      'obsidianmd/commands/no-plugin-name-in-command-name': `off`,
    },
  },
])
