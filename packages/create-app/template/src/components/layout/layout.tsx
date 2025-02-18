import { ReactNode } from 'react'
import { Sidebar } from './sidebar'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen">
      <div className="w-64 shrink-0">
        <Sidebar />
      </div>
      <main className="flex-1 overflow-y-auto bg-white p-8">
        {children}
      </main>
    </div>
  )
} 