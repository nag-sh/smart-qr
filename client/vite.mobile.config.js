import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.js'

export default mergeConfig(base, defineConfig({
  base: './',
}))
