import type { Project } from '../types'
import type { Locale } from '../i18n/core'
import { translateText } from '../i18n/translate'
import { buildAiPrompt, buildSrtFromSubtitles } from './framePackage'
import type { LooseSheetInfo } from './framePackage'

// AI 直连(BYOK):用户填自己的 API key,一键完成全片分析,替代"打包→上传→导回"的手动流程。
// 请求统一走 OpenAI 兼容的 /chat/completions,由 dev server 的 ai-proxy-server-plugin 转发绕开 CORS。
// key 只存本机 localStorage,不进项目数据,不随备份 ZIP 导出。

export interface DirectAiProvider {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  vision: boolean
}

// 预设的 baseUrl/model 会过时,全部允许用户改;自定义档从零填。
// 刻意不预设 DeepSeek 等纯文本模型:看不了画面,拆视觉型影片时 techniques/无对白段落/情绪曲线全瞎,
// 预设进来等于引导用户用残血模式。确实要用的走「自定义」+取消勾选拼图,工具会退到纯字幕分析。
export const DIRECT_AI_PROVIDERS: DirectAiProvider[] = [
  { id: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimax.io/v1', defaultModel: 'MiniMax-M3', vision: true },
  { id: 'gemini', label: 'Gemini (Google)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-flash', vision: true },
  { id: 'kimi', label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-latest', vision: true },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', vision: true },
  { id: 'claude', label: 'Claude (Anthropic)', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-opus-5', vision: true },
  { id: 'custom', label: 'Пользовательский', baseUrl: '', defaultModel: '', vision: true },
]

export interface DirectAiConfig {
  providerId: string
  baseUrl: string
  model: string
  apiKey: string
  sendFrames: boolean
  providerKeys?: Record<string, string>
}

const CONFIG_STORAGE_KEY = 'lapian-notes.direct-ai.v1'

export function getEnvApiKey(providerId: string): string {
  try {
    if (typeof __AI_ENV_KEYS__ !== 'undefined' && __AI_ENV_KEYS__ && typeof __AI_ENV_KEYS__[providerId] === 'string') {
      const val = __AI_ENV_KEYS__[providerId].trim()
      if (val) return val
    }
  } catch {
    // fallback
  }
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const key = `VITE_${providerId.toUpperCase()}_API_KEY`
    const val = import.meta.env[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  return ''
}

export function loadDirectAiConfig(): DirectAiConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DirectAiConfig> & { providerKeys?: Record<string, string> }
      // 存过的服务商可能已被移出预设(如 DeepSeek),回落默认档
      if (typeof parsed.providerId === 'string' && DIRECT_AI_PROVIDERS.some((item) => item.id === parsed.providerId)) {
        const envKey = getEnvApiKey(parsed.providerId)
        const storedKey = parsed.providerKeys?.[parsed.providerId] ?? (typeof parsed.apiKey === 'string' ? parsed.apiKey : '')
        return {
          providerId: parsed.providerId,
          baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : (DIRECT_AI_PROVIDERS.find((item) => item.id === parsed.providerId)?.baseUrl ?? ''),
          model: typeof parsed.model === 'string' && parsed.model ? parsed.model : (DIRECT_AI_PROVIDERS.find((item) => item.id === parsed.providerId)?.defaultModel ?? ''),
          apiKey: storedKey.trim() || envKey,
          sendFrames: parsed.sendFrames !== false,
          providerKeys: parsed.providerKeys || {},
        }
      }
    }
  } catch {
    // 存储损坏时回落默认配置
  }
  const providerWithEnvKey = DIRECT_AI_PROVIDERS.find((item) => item.id !== 'custom' && Boolean(getEnvApiKey(item.id)))
  const preset = providerWithEnvKey ?? DIRECT_AI_PROVIDERS[0]
  const envKey = getEnvApiKey(preset.id)
  return {
    providerId: preset.id,
    baseUrl: preset.baseUrl,
    model: preset.defaultModel,
    apiKey: envKey,
    sendFrames: preset.vision,
    providerKeys: {},
  }
}

export function saveDirectAiConfig(config: DirectAiConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // 存不进去(隐私模式等)不影响本次分析
  }
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: 'user'
  content: string | ChatContentPart[]
}

// 组装发给 AI 的单条 user 消息:任务说明 + 字幕全文 + (可选)画面拼图。
// sheets 为空即纯字幕模式,prompt 措辞随之切换(buildAiPrompt 的 direct 分支)。
export async function buildDirectAiMessages(
  project: Project,
  locale: Locale,
  sheets?: { blobs: Blob[]; info: LooseSheetInfo },
): Promise<ChatMessage[]> {
  const prompt = buildAiPrompt(project, locale, sheets?.info, true)
  const srt = project.subtitles.length
    ? `${translateText('字幕全文（SRT 格式，时间为全片时间轴）：', locale)}\n\n${buildSrtFromSubtitles(project.subtitles)}`
    : ''
  const textBody = srt ? `${prompt}\n\n${srt}` : prompt

  if (!sheets || !sheets.blobs.length) {
    return [{ role: 'user', content: textBody }]
  }
  const parts: ChatContentPart[] = [{ type: 'text', text: textBody }]
  for (const blob of sheets.blobs) {
    parts.push({ type: 'image_url', image_url: { url: await blobToDataUrl(blob) } })
  }
  return [{ role: 'user', content: parts }]
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片编码失败'))
    reader.readAsDataURL(blob)
  })
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
  error?: { message?: string } | string
}

export async function runDirectAiAnalysis(
  config: DirectAiConfig,
  messages: ChatMessage[],
  locale: Locale,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        messages,
      }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error(translateText('无法连接本地转发接口。AI 直连需要在本地 dev server 下使用（run.bat 启动的完整版）。', locale), { cause: error })
  }
  if (response.status === 404) {
    // 静态部署(在线试用版)没有转发接口
    throw new Error(translateText('当前环境没有 AI 转发接口。AI 直连仅完整版可用，在线试用版请下载完整版。', locale))
  }
  const raw = await response.text()
  let data: ChatCompletionResponse | null = null
  try {
    data = JSON.parse(raw) as ChatCompletionResponse
  } catch {
    // 上游返回非 JSON,按错误处理
  }
  if (!response.ok) {
    const detail = extractErrorMessage(data) || raw.slice(0, 300)
    throw new Error(`${translateText('AI 服务返回错误', locale)}(HTTP ${response.status}): ${detail}`)
  }
  const text = extractResponseText(data)
  if (!text.trim()) {
    throw new Error(translateText('AI 返回了空内容，请换个模型或稍后重试。', locale))
  }
  return text
}

function extractErrorMessage(data: ChatCompletionResponse | null): string {
  if (!data?.error) return ''
  if (typeof data.error === 'string') return data.error
  return data.error.message ?? ''
}

// content 可能是纯字符串,也可能是分块数组(部分兼容实现);两种都接
// 过滤掉推理模型附带的思考过程(如 <think>...</think>),保证 JSON 解析稳定
export function extractResponseText(data: ChatCompletionResponse | null): string {
  const content = data?.choices?.[0]?.message?.content
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .filter((part) => part && (part.type === undefined || part.type === 'text') && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
  }
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  return stripped || text.trim()
}
