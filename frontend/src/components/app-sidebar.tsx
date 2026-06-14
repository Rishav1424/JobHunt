'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  Settings,
  Zap,
  TrendingUp,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Job Queue', icon: Briefcase },
  { href: '/applications', label: 'Applications', icon: FileText },
  { href: '/analytics', label: 'Analytics', icon: TrendingUp },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { state } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      {/* Logo Section */}
      <SidebarHeader className="flex h-16 items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary shrink-0">
            <Zap className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          {state === 'expanded' && (
            <span className="text-sm font-bold tracking-wide text-sidebar-foreground animate-in fade-in duration-200">
              JobHunt AI
            </span>
          )}
        </div>
      </SidebarHeader>

      {/* Navigation Menu */}
      <SidebarContent className="p-3">
        <SidebarMenu className="space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton
                  isActive={active}
                  title={label}
                  render={<Link href={href} />}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {state === 'expanded' && (
                    <span className="text-sm font-medium animate-in fade-in duration-200">
                      {label}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      {/* Footer Profile */}
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
            RS
          </div>
          {state === 'expanded' && (
            <div className="min-w-0 flex-1 animate-in fade-in duration-200">
              <p className="truncate text-xs font-semibold text-sidebar-foreground">Rishav Sharma</p>
              <p className="truncate text-[10px] text-muted-foreground">NIT Durgapur '26</p>
            </div>
          )}
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
