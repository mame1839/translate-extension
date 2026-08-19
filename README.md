# AI Website Translator

**Chrome Web Store:**
[https://chromewebstore.google.com/detail/ai-website-translator/dchjlinbddpaiddipiflefedphldelki](https://chromewebstore.google.com/detail/ai-website-translator/dchjlinbddpaiddipiflefedphldelki)

**言語 / Language / 语言 / 언어 / Язык:**
[日本語](#日本語) | [English](#english) | [中文](#中文) | [한국어](#한국어) | [Русский](#русский)

---

## 日本語

### 概要

Google Gemini・OpenAI・Anthropic などの AI API を使ってウェブページをその場で翻訳する Chrome 拡張機能です。ページ構造やリンク・書式を保ったまま、21 言語に対応しています。

### 主な機能

- **4 つの AI プロバイダー対応** — Gemini、OpenAI、Anthropic、OpenAI 互換エンドポイント
- **21 言語に翻訳可能** — 英語・日本語・中国語・韓国語・アラビア語・ロシア語など
- **ページ構造を保持** — リンク・太字・見出しなどの書式をそのまま維持
- **適用結果を検証** — 訳文を正しく表示できない箇所は原文のまま残し、レイアウトを崩さない
- **バッチ処理 & 並列リクエスト** — 大きなページも高速に翻訳
- **言語別のページキャッシュ** — 翻訳結果を翻訳先の言語ごとに保存し、ページ単位で削除可能
- **キャッシュから無料で復元** — キャッシュのあるページも勝手には復元せず、ポップアップで「キャッシュから復元（無料）」と「翻訳（API）」を選べる。復元できる割合も表示
- **失敗箇所だけを再翻訳** — 翻訳に失敗した箇所の件数を表示し、その箇所だけを再翻訳可能
- **選択範囲の翻訳** — 右クリックから選択したテキストを翻訳し、その場で置き換えることも可能
- **翻訳の切り替え** — 翻訳済みと原文をワンクリックで切り替え
- **除外リスト** — 特定サイトを翻訳対象から除外
- **自動翻訳は既定でオフ** — ページ読み込み時や動的に追加されたコンテンツの自動翻訳は、設定で有効にした場合のみ上限の範囲で動作

### インストール

**Chrome Web Store から（推奨）:**
[Chrome Web Store のページ](https://chromewebstore.google.com/detail/ai-website-translator/dchjlinbddpaiddipiflefedphldelki) から「Chrome に追加」をクリックするだけでインストールできます。

**GitHub Releases からダウンロードして手動インストール:**
1. [Releases ページ](https://github.com/mame1839/translate-extension/releases/latest) から最新の `translate-extension.zip` をダウンロードして解凍する
2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパーモード」をオンにする
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. 解凍したフォルダを選択する

### 使い方

1. ツールバーの拡張機能アイコンをクリック
2. 「Translate」ボタンを押すと翻訳開始
3. 設定ページで API キーとプロバイダーを登録
4. 右クリックメニューからも翻訳の切り替えが可能

### 対応 AI プロバイダーとデフォルトモデル

| プロバイダー | デフォルトモデル |
|---|---|
| Google Gemini | `gemini-3.1-flash-lite` |
| OpenAI | `gpt-5.4-nano-2026-03-17` |
| Anthropic | `claude-haiku-4-5-20251001` |
| OpenAI 互換 | 任意のモデル |

### 翻訳先対応言語

英語 / 日本語 / 中国語（簡体・繁体）/ 韓国語 / スペイン語 / フランス語 / ドイツ語 / ポルトガル語 / ロシア語 / アラビア語 / ヒンディー語 / ベンガル語 / ウルドゥー語 / インドネシア語 / スワヒリ語 / マラーティー語 / テルグ語 / タミル語 / トルコ語 / ベトナム語

### 主な設定項目

| 項目 | デフォルト | 説明 |
|---|---|---|
| 最大出力トークン | 65536 | API の最大出力トークン数 |
| リクエスト間隔 | 10 秒 | リクエスト間のディレイ |
| 並列数上限 | 10 | 同時リクエスト数 |
| タイムアウト | 180 秒 | API タイムアウト |
| リトライ回数 | 3 | エラー時の最大再試行回数 |

### ライセンス

本ソフトウェアは [GNU General Public License v3.0](LICENSE) のもとで配布されています。改変版・再配布版も同じライセンスで公開する必要があります。

Copyright (C) 2026 mame1839

---

## English

### Overview

A Chrome extension that translates web pages in place using AI APIs — Google Gemini, OpenAI, Anthropic, or any OpenAI-compatible endpoint. Supports 21 languages while preserving page structure, links, and formatting.

### Features

- **4 AI providers** — Gemini, OpenAI, Anthropic, and OpenAI-compatible endpoints
- **21 target languages** — English, Japanese, Chinese, Korean, Arabic, Russian, and more
- **Structure-preserving** — keeps links, bold text, headings, and layout intact
- **Verified application** — spots where the translation cannot be rendered correctly keep their original text, so the layout never breaks
- **Batch processing & concurrency** — translates large pages quickly
- **Per-language page cache** — translations are stored per target language and can be deleted page by page
- **Free restore from cache** — cached pages are never restored unasked; the popup offers "Restore from cache (free)" and "Translate (API)" separately and shows how much can be restored
- **Retry only failed parts** — shows how many parts failed to translate and re-translates just those
- **Selection translation** — translate selected text from the right-click menu, optionally replacing it in place
- **Toggle translations** — switch between translated and original text with one click
- **Exclusion list** — skip translation on specified sites
- **Auto-translate off by default** — automatic translation on page load and for dynamically added content runs only when enabled in settings, within per-page limits

### Installation

**From the Chrome Web Store (recommended):**
Click **Add to Chrome** on the [Chrome Web Store page](https://chromewebstore.google.com/detail/ai-website-translator/dchjlinbddpaiddipiflefedphldelki).

**Manual installation from GitHub Releases:**
1. Download the latest `translate-extension.zip` from the [Releases page](https://github.com/mame1839/translate-extension/releases/latest) and extract it
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** in the top-right corner
4. Click **Load unpacked**
5. Select the extracted folder

### How to Use

1. Click the extension icon in the toolbar
2. Press **Translate** to start
3. Register your API key and provider in the Settings page
4. You can also toggle translation from the right-click context menu

### Supported AI Providers and Default Models

| Provider | Default Model |
|---|---|
| Google Gemini | `gemini-3.1-flash-lite` |
| OpenAI | `gpt-5.4-nano-2026-03-17` |
| Anthropic | `claude-haiku-4-5-20251001` |
| OpenAI Compatible | Any model |

### Supported Target Languages

English / Japanese / Chinese (Simplified & Traditional) / Korean / Spanish / French / German / Portuguese / Russian / Arabic / Hindi / Bengali / Urdu / Indonesian / Swahili / Marathi / Telugu / Tamil / Turkish / Vietnamese

### Key Settings

| Setting | Default | Description |
|---|---|---|
| Max output tokens | 65536 | Maximum tokens per API response |
| Delay between requests | 10 s | Pause between batch requests |
| Concurrency limit | 10 | Maximum simultaneous requests |
| API timeout | 180 s | Request timeout |
| Max retries | 3 | Retry attempts on error |

### License

Released under the [GNU General Public License v3.0](LICENSE). Modified or redistributed versions must also be released under the same license.

Copyright (C) 2026 mame1839

---

## 中文

### 概述

一款使用 AI API（Google Gemini、OpenAI、Anthropic 或兼容 OpenAI 的端点）直接在页面内翻译网页的 Chrome 扩展程序。支持 21 种语言，同时保留页面结构、链接和格式。

### 主要功能

- **支持 4 种 AI 提供商** — Gemini、OpenAI、Anthropic 及 OpenAI 兼容端点
- **支持 21 种目标语言** — 英语、日语、中文、韩语、阿拉伯语、俄语等
- **保留页面结构** — 保持链接、粗体、标题和布局不变
- **校验应用结果** — 无法正确显示译文的部分保留原文，不破坏页面布局
- **批量处理 & 并发请求** — 快速翻译大型页面
- **按语言保存页面缓存** — 按目标语言分别保存翻译结果，并可按页面删除
- **从缓存免费恢复** — 有缓存的页面不会被擅自恢复；弹出窗口分别提供“从缓存恢复（免费）”和“翻译（API）”，并显示可恢复的比例
- **仅重译失败部分** — 显示翻译失败部分的数量，并可只重新翻译这些部分
- **翻译选中文本** — 通过右键菜单翻译选中的文本，也可就地替换
- **切换翻译** — 一键在翻译版本和原文之间切换
- **排除列表** — 指定不翻译的网站
- **自动翻译默认关闭** — 页面加载时和动态加载内容的自动翻译，仅在设置中启用后才会在上限范围内运行

### 安装方法

**从 Chrome 网上应用店安装（推荐）：**
在 [Chrome 网上应用店页面](https://chromewebstore.google.com/detail/ai-website-translator/dchjlinbddpaiddipiflefedphldelki) 点击**添加至 Chrome** 即可完成安装。

**从 GitHub Releases 下载手动安装：**
1. 从 [Releases 页面](https://github.com/mame1839/translate-extension/releases/latest) 下载最新的 `translate-extension.zip` 并解压
2. 在 Chrome 中打开 `chrome://extensions`
3. 开启右上角的**开发者模式**
4. 点击**加载已解压的扩展程序**
5. 选择解压后的文件夹

### 使用方法

1. 点击工具栏中的扩展程序图标
2. 点击 **Translate** 按钮开始翻译
3. 在设置页面中填写 API 密钥和提供商信息
4. 也可以通过右键菜单切换翻译

### 支持的 AI 提供商及默认模型

| 提供商 | 默认模型 |
|---|---|
| Google Gemini | `gemini-3.1-flash-lite` |
| OpenAI | `gpt-5.4-nano-2026-03-17` |
| Anthropic | `claude-haiku-4-5-20251001` |
| OpenAI 兼容 | 任意模型 |

### 支持的目标语言

英语 / 日语 / 中文（简体・繁体）/ 韩语 / 西班牙语 / 法语 / 德语 / 葡萄牙语 / 俄语 / 阿拉伯语 / 印地语 / 孟加拉语 / 乌尔都语 / 印度尼西亚语 / 斯瓦希里语 / 马拉地语 / 泰卢固语 / 泰米尔语 / 土耳其语 / 越南语

### 主要设置项

| 设置 | 默认值 | 说明 |
|---|---|---|
| 最大输出 Token | 65536 | API 每次响应的最大 Token 数 |
| 请求间隔 | 10 秒 | 批次请求之间的延迟 |
| 并发上限 | 10 | 最大同时请求数 |
| 超时时间 | 180 秒 | API 请求超时时间 |
| 最大重试次数 | 3 | 出错时的最大重试次数 |

### 许可证

本软件基于 [GNU General Public License v3.0](LICENSE) 发布。修改版和再分发版也必须以相同的许可证发布。

Copyright (C) 2026 mame1839

---

## 한국어

### 개요

Google Gemini, OpenAI, Anthropic 또는 OpenAI 호환 엔드포인트 등의 AI API를 사용하여 웹 페이지를 즉석에서 번역하는 Chrome 확장 프로그램입니다. 페이지 구조, 링크, 서식을 유지하면서 21개 언어를 지원합니다.

### 주요 기능

- **4가지 AI 공급자 지원** — Gemini, OpenAI, Anthropic, OpenAI 호환 엔드포인트
- **21개 대상 언어** — 영어, 일본어, 중국어, 한국어, 아랍어, 러시아어 등
- **페이지 구조 유지** — 링크, 굵은 글씨, 제목, 레이아웃 그대로 유지
- **적용 결과 검증** — 번역문을 올바르게 표시할 수 없는 부분은 원문을 유지하여 레이아웃이 깨지지 않음
- **배치 처리 & 병렬 요청** — 대형 페이지도 빠르게 번역
- **언어별 페이지 캐시** — 번역 결과를 대상 언어별로 저장하고 페이지 단위로 삭제 가능
- **캐시에서 무료 복원** — 캐시가 있는 페이지도 자동으로 복원하지 않으며, 팝업에서 "캐시에서 복원(무료)"과 "번역(API)"을 따로 선택. 복원 가능한 비율도 표시
- **실패한 부분만 재번역** — 번역에 실패한 부분의 개수를 표시하고 그 부분만 다시 번역 가능
- **선택 영역 번역** — 우클릭 메뉴에서 선택한 텍스트를 번역하고 그 자리에서 교체도 가능
- **번역 전환** — 번역문과 원문을 클릭 한 번으로 전환
- **제외 목록** — 특정 사이트 번역 제외 설정
- **자동 번역 기본 꺼짐** — 페이지 로드 시 및 동적으로 추가된 콘텐츠의 자동 번역은 설정에서 켠 경우에만 상한 범위 내에서 동작

### 설치 방법

**Chrome 웹 스토어에서 설치（권장）:**
[Chrome 웹 스토어 페이지](https://chromewebstore.google.com/detail/ai-website-translator/dchjlinbddpaiddipiflefedphldelki)에서 **Chrome에 추가**를 클릭하면 바로 설치됩니다.

**GitHub Releases에서 다운로드하여 직접 설치:**
1. [Releases 페이지](https://github.com/mame1839/translate-extension/releases/latest)에서 최신 `translate-extension.zip`을 다운로드하여 압축 해제합니다
2. Chrome에서 `chrome://extensions`를 엽니다
3. 오른쪽 상단의 **개발자 모드**를 켭니다
4. **압축 해제된 확장 프로그램 로드**를 클릭합니다
5. 압축 해제된 폴더를 선택합니다

### 사용 방법

1. 툴바의 확장 프로그램 아이콘 클릭
2. **Translate** 버튼을 눌러 번역 시작
3. 설정 페이지에서 API 키와 공급자를 등록
4. 우클릭 컨텍스트 메뉴에서도 번역 전환 가능

### 지원 AI 공급자 및 기본 모델

| 공급자 | 기본 모델 |
|---|---|
| Google Gemini | `gemini-3.1-flash-lite` |
| OpenAI | `gpt-5.4-nano-2026-03-17` |
| Anthropic | `claude-haiku-4-5-20251001` |
| OpenAI 호환 | 임의 모델 |

### 지원 대상 언어

영어 / 일본어 / 중국어（간체·번체）/ 한국어 / 스페인어 / 프랑스어 / 독일어 / 포르투갈어 / 러시아어 / 아랍어 / 힌디어 / 벵골어 / 우르두어 / 인도네시아어 / 스와힐리어 / 마라티어 / 텔루구어 / 타밀어 / 터키어 / 베트남어

### 주요 설정 항목

| 설정 | 기본값 | 설명 |
|---|---|---|
| 최대 출력 토큰 | 65536 | API 응답당 최대 토큰 수 |
| 요청 간격 | 10 초 | 배치 요청 간 대기 시간 |
| 동시 요청 상한 | 10 | 최대 동시 요청 수 |
| 타임아웃 | 180 초 | API 요청 타임아웃 |
| 최대 재시도 횟수 | 3 | 오류 시 최대 재시도 횟수 |

### 라이선스

본 소프트웨어는 [GNU General Public License v3.0](LICENSE)에 따라 배포됩니다. 수정판이나 재배포판도 동일한 라이선스로 공개해야 합니다.

Copyright (C) 2026 mame1839

---

## Русский

### Обзор

Расширение для Chrome, которое переводит веб-страницы прямо на месте с помощью AI API — Google Gemini, OpenAI, Anthropic или любого совместимого с OpenAI эндпоинта. Поддерживает 21 язык, сохраняя структуру страницы, ссылки и форматирование.

### Основные возможности

- **4 провайдера AI** — Gemini, OpenAI, Anthropic и совместимые с OpenAI эндпоинты
- **21 язык перевода** — английский, японский, китайский, корейский, арабский, русский и другие
- **Сохранение структуры** — ссылки, жирный текст, заголовки и разметка остаются нетронутыми
- **Проверка результата применения** — участки, где перевод не удаётся отобразить корректно, остаются на языке оригинала, поэтому вёрстка не ломается
- **Пакетная обработка и параллельные запросы** — быстрый перевод больших страниц
- **Кэш страниц по языкам** — переводы хранятся отдельно для каждого целевого языка и удаляются постранично
- **Бесплатное восстановление из кэша** — страницы с кэшем не восстанавливаются без спроса: во всплывающем окне есть отдельные кнопки «Восстановить из кэша (бесплатно)» и «Перевести (API)», а также показывается доля восстановимого
- **Повторный перевод только неудачных мест** — показывает число участков, которые не удалось перевести, и переводит заново только их
- **Перевод выделенного текста** — переводит выделенный фрагмент через контекстное меню, при желании заменяя его на месте
- **Переключение перевода** — одним кликом переключаться между переводом и оригиналом
- **Список исключений** — отключить перевод для выбранных сайтов
- **Автоперевод по умолчанию выключен** — автоматический перевод при загрузке страницы и динамически добавляемого контента работает только если включён в настройках, в пределах лимита

### Установка

**Из Chrome Web Store（рекомендуется）:**
Нажмите **Установить** на [странице Chrome Web Store](https://chromewebstore.google.com/detail/ai-website-translator/dchjlinbddpaiddipiflefedphldelki).

**Ручная установка из GitHub Releases:**
1. Скачайте последний `translate-extension.zip` со [страницы Releases](https://github.com/mame1839/translate-extension/releases/latest) и распакуйте его
2. Откройте `chrome://extensions` в Chrome
3. Включите **Режим разработчика** в правом верхнем углу
4. Нажмите **Загрузить распакованное расширение**
5. Выберите распакованную папку

### Как использовать

1. Нажмите на иконку расширения на панели инструментов
2. Нажмите кнопку **Translate** для начала перевода
3. Введите API-ключ и выберите провайдера на странице настроек
4. Перевод также можно переключить через контекстное меню правой кнопкой мыши

### Поддерживаемые провайдеры AI и модели по умолчанию

| Провайдер | Модель по умолчанию |
|---|---|
| Google Gemini | `gemini-3.1-flash-lite` |
| OpenAI | `gpt-5.4-nano-2026-03-17` |
| Anthropic | `claude-haiku-4-5-20251001` |
| Совместимый с OpenAI | Любая модель |

### Поддерживаемые языки перевода

Английский / Японский / Китайский (упрощённый и традиционный) / Корейский / Испанский / Французский / Немецкий / Португальский / Русский / Арабский / Хинди / Бенгальский / Урду / Индонезийский / Суахили / Маратхи / Телугу / Тамильский / Турецкий / Вьетнамский

### Основные настройки

| Настройка | По умолчанию | Описание |
|---|---|---|
| Макс. токенов на выходе | 65536 | Максимальное количество токенов в ответе API |
| Задержка между запросами | 10 с | Пауза между пакетными запросами |
| Лимит параллельных запросов | 10 | Максимальное число одновременных запросов |
| Тайм-аут API | 180 с | Время ожидания ответа API |
| Макс. повторных попыток | 3 | Число повторных попыток при ошибке |

### Лицензия

Программа распространяется по лицензии [GNU General Public License v3.0](LICENSE). Изменённые версии и повторные распространения также должны выпускаться под этой лицензией.

Copyright (C) 2026 mame1839
