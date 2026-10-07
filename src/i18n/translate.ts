import { englishCatalog } from './catalog.en.ts'
import { russianCatalog } from './catalog.ru.ts'
import { createTranslator, type Locale } from './core.ts'

const translateEnglish = createTranslator(englishCatalog)
const translateRussian = createTranslator(russianCatalog)

export function translateText(source: string, locale: Locale): string {
  if (locale === 'en') return translateEnglish(source)
  if (locale === 'ru') return translateRussian(source)
  return source
}
