"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Car, Activity, Server, Cloud } from "lucide-react"
import { cn } from "@/lib/utils"

const navigation = [
  { name: "Dashboard (Browser)", href: "/", icon: LayoutDashboard },
  { name: "Node.js Example", href: "/nodejs-example", icon: Server },
  { name: "Streaming Demo", href: "/streaming", icon: Activity },
  { name: "Cache Demo", href: "/cache", icon: Cloud },
  { name: "Server Streaming", href: "/streaming/server", icon: Cloud },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col gap-y-5 bg-gray-900 px-6 pb-4">
      <div className="flex h-16 shrink-0 items-center text-white">
        <span className="text-xl font-bold">hypequery</span>
      </div>
      <nav className="flex flex-1 flex-col">
        <ul role="list" className="flex flex-1 flex-col gap-y-7">
          <li>
            <ul role="list" className="-mx-2 space-y-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href
                return (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      className={cn(
                        isActive
                          ? "bg-gray-800 text-white"
                          : "text-gray-400 hover:text-white hover:bg-gray-800",
                        "group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold"
                      )}
                    >
                      <item.icon
                        className={cn(
                          isActive ? "text-white" : "text-gray-400 group-hover:text-white",
                          "h-6 w-6 shrink-0"
                        )}
                        aria-hidden="true"
                      />
                      {item.name}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </li>
        </ul>
      </nav>
    </div>
  )
} 
