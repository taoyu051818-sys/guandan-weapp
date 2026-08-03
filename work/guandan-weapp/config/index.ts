import { defineConfig, type UserConfigExport } from '@tarojs/cli'

export default defineConfig<'webpack5'>(async (): Promise<UserConfigExport<'webpack5'>> => ({
  projectName: 'guandan-weapp',
  date: '2026-08-03',
  designWidth: 750,
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  plugins: [],
  mini: {},
  h5: {}
}))
