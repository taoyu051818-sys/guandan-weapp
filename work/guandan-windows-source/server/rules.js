// 保留旧导入路径的兼容层；实现统一由 shared-core 提供。
import core from '../../../shared-core/dist/index.js'

export const { PlayType, getPlayInfos, getPlayInfo, canPlay } = core
