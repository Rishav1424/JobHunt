import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { AuthGuard } from '@/components/auth-guard';
import { ScrollArea } from '@/components/ui/scroll-area';

export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <div className="flex h-screen w-full overflow-hidden">
          <AppSidebar />
          <SidebarInset className="flex flex-col flex-1 overflow-hidden">
            <header className="flex shrink-0 items-center gap-2 border-b px-4 md:px-6 py-4">
              <SidebarTrigger />
              <Separator orientation="vertical" />
              <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">JobHunt AI</span>
            </header>
            <section className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                {children}
              </ScrollArea>
            </section>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AuthGuard>
  );
}
