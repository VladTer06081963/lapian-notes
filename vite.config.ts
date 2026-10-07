import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { subtitleFinderPlugin } from './subtitle-server-plugin'
import { transcodeServerPlugin } from './transcode-server-plugin'
import { aiProxyServerPlugin } from './ai-proxy-server-plugin'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), subtitleFinderPlugin(), transcodeServerPlugin(), aiProxyServerPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // 在线试用版(GitHub Pages)构建时置 ONLINE_DEMO=1,应用内据此显示在线版说明与完整版差异
      __ONLINE_DEMO__: JSON.stringify(process.env.ONLINE_DEMO === '1'),
      __AI_ENV_KEYS__: JSON.stringify({
        minimax: env.MINIMAX_API_KEY || env.VITE_MINIMAX_API_KEY || '',
        gemini: env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || '',
        kimi: env.KIMI_API_KEY || env.VITE_KIMI_API_KEY || '',
        openai: env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || '',
        claude: env.CLAUDE_API_KEY || env.VITE_CLAUDE_API_KEY || '',
      }),
    },
  }
})
