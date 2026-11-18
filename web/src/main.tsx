import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { applyPlatformClasses } from './lib/platform'
import { installMathCopyHandler } from './chat/markdownClipboard'
import { useSettings } from './store/settings'
import App from './App'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github-dark.css'
import './index.css'

applyPlatformClasses()
installMathCopyHandler(() => useSettings.getState().preferences.copyWithFormatting)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
