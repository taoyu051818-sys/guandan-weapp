import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  base: './', // 设为相对路径以支持 Electron 打包后的本地 file:// 协议
  server: {
    port: 6677,
    strictPort: true, // 确保端口不会被占用导致启动失败
    host: true, // 允许外部网络访问 (绑定到 0.0.0.0)
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: 'hidden',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html'
      },
      output: {
        manualChunks: {
          react_vendor: ['react', 'react-dom'],
          motion_vendor: ['framer-motion'],
          socket_vendor: ['socket.io-client'],
          zustand_vendor: ['zustand'],
          ui_vendor: ['lucide-react'],
        },
      }
    }
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    tsconfigPaths()
  ],
})
