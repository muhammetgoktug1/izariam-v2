import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The world only advances when the server ticks it, and the tick runs
      // on read -- so a stale cache is a stale world. Keep it short.
      staleTime: 5_000,
      refetchOnMount: 'always',
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
