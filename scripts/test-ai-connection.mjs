import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvKeys() {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return {}
  const content = readFileSync(envPath, 'utf8')
  const keys = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const k = trimmed.slice(0, idx).trim()
    const v = trimmed.slice(idx + 1).trim()
    keys[k] = v
  }
  return keys
}

async function main() {
  console.log('🔍 Проверка подключения к AI (MiniMax)...\n')
  const env = loadEnvKeys()
  const apiKey = (env.MINIMAX_API_KEY || env.VITE_MINIMAX_API_KEY || process.env.MINIMAX_API_KEY || '').trim()

  if (!apiKey) {
    console.error('❌ Ключ не найден в файле .env!')
    console.log('Пожалуйста, откройте файл .env и укажите ваш ключ:')
    console.log('MINIMAX_API_KEY=ваш_ключ_здесь\n')
    process.exit(1)
  }

  const maskedKey = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : '••••'
  console.log(`🔑 Найден ключ: ${maskedKey}`)
  console.log('🌐 Отправка тестового запроса к https://api.minimax.io/v1/chat/completions...')

  const startTime = Date.now()
  try {
    const response = await fetch('https://api.minimax.io/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-VL-01',
        messages: [{ role: 'user', content: 'Привет! Ответь одним словом: "Работает".' }],
        max_tokens: 50,
      }),
      signal: AbortSignal.timeout(30000),
    })

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    const raw = await response.text()

    if (!response.ok) {
      console.error(`\n❌ Ошибка API (HTTP ${response.status}) за ${duration}с:`)
      console.error(raw)
      if (response.status === 401) {
        console.log('\n💡 Совет: Проверьте правильность API ключа или не истекла ли подписка/баланс.')
      } else if (response.status === 400 && raw.includes('model')) {
        console.log('\n💡 Совет: Попробуйте модель MiniMax-Text-01 или MiniMax-M3.1-Flash-Preview.')
      }
      process.exit(1)
    }

    let data
    try {
      data = JSON.parse(raw)
    } catch {
      data = null
    }

    const reply = data?.choices?.[0]?.message?.content ?? raw
    console.log(`\n✅ Успешно! Подключение к MiniMax работает (время ответа: ${duration}с).`)
    console.log(`💬 Ответ модели: ${typeof reply === 'string' ? reply.trim() : JSON.stringify(reply)}`)
  } catch (err) {
    console.error(`\n❌ Сбой сети или таймаут: ${err.message}`)
    process.exit(1)
  }
}

main()
