import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Moderation reads should be fresh; a stale ban state is the one thing
      // this tool must not show.
      staleTime: 0,
      refetchOnMount: 'always',
      retry: false,
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
