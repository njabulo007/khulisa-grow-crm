import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  FolderKanban,
  FileText,
  Wallet,
  BarChart3,
  Settings,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  ownerOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: <LayoutDashboard className="h-5 w-5" /> },
  { label: 'Leads', href: '/leads', icon: <Users className="h-5 w-5" /> },
  { label: 'Clients', href: '/clients', icon: <UserCheck className="h-5 w-5" /> },
  { label: 'Projects', href: '/projects', icon: <FolderKanban className="h-5 w-5" /> },
  { label: 'Invoices', href: '/invoices', icon: <FileText className="h-5 w-5" /> },
  { label: 'Commissions', href: '/commissions', icon: <Wallet className="h-5 w-5" /> },
  { label: 'Reports', href: '/reports', icon: <BarChart3 className="h-5 w-5" />, ownerOnly: true },
  { label: 'Settings', href: '/settings', icon: <Settings className="h-5 w-5" /> },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const { isOwner } = useAuth();

  const filteredItems = navItems.filter(item => !item.ownerOnly || isOwner);

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <img
          src="/images/khulisa-logo-icon.png"
          alt="Khulisa Grow CRM logo"
          className="h-9 w-9 rounded-md object-cover"
        />
        <div>
          <h1 className="font-display text-lg font-bold text-sidebar-foreground">Khulisa</h1>
          <p className="text-xs text-sidebar-foreground/60">CRM</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {filteredItems.map((item) => {
          const isActive = location.pathname === item.href || 
            (item.href !== '/' && location.pathname.startsWith(item.href));
          
          return (
            <NavLink
              key={item.href}
              to={item.href}
              onClick={onNavigate}
              className={cn(
                'sidebar-link group',
                isActive && 'active'
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {isActive && (
                <ChevronRight className="h-4 w-4 opacity-50" />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-4">
        <p className="text-xs text-sidebar-foreground/50">
          (c) 2026 Khulisa Media
        </p>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile Menu Button */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="fixed left-4 top-4 z-50 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarContent />
      </aside>
    </>
  );
}
