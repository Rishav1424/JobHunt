import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { AuthGuard } from '@/components/auth-guard';

export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <div className="flex h-screen w-full overflow-hidden">
          <AppSidebar />
          <SidebarInset className="flex flex-col flex-1 overflow-hidden">
            <header className="flex shrink-0 items-center gap-2 border-b px-4 md:px-6 py-2 bg-sidebar">
              <SidebarTrigger />
              <Separator orientation="vertical" />
              <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">JobHunt AI</span>
            </header>
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AuthGuard>
  );
}
