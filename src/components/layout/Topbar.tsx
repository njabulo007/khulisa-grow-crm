import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Moon,
  Sun,
  Bell,
  ChevronDown,
  LogOut,
  Users,
  Building2,
  FileText,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { canAccessInvoice, getAgentLinkedClientIds } from '@/lib/permissions';
import { clientService, invoiceService, leadService, projectService } from '@/services';

interface TopbarProps {
  onSearch?: (query: string) => void;
}

const MAX_RESULTS_PER_GROUP = 5;

type SearchItem = {
  id: string;
  title: string;
  subtitle?: string;
  path: string;
};

export function Topbar({ onSearch }: TopbarProps) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, isOwner, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query || !user) {
      return { leads: [] as SearchItem[], clients: [] as SearchItem[], invoices: [] as SearchItem[] };
    }

    const allLeads = leadService.getAll();
    const allClients = clientService.getAll();
    const allProjects = projectService.getAll();
    const allInvoices = invoiceService.getAll();

    const visibleLeads = isOwner ? allLeads : allLeads.filter((lead) => lead.assignedTo === user.id);
    const accessibleClientIds = isOwner
      ? new Set(allClients.map((client) => client.id))
      : getAgentLinkedClientIds(user.id, allLeads, allClients, allProjects);
    const visibleClients = allClients.filter((client) => accessibleClientIds.has(client.id));
    const visibleInvoices = allInvoices.filter((invoice) =>
      isOwner ? true : canAccessInvoice(user, invoice, allLeads, allClients, allProjects)
    );

    const leads = visibleLeads
      .filter(
        (lead) =>
          lead.businessName.toLowerCase().includes(query) ||
          lead.contactName.toLowerCase().includes(query)
      )
      .slice(0, MAX_RESULTS_PER_GROUP)
      .map((lead) => ({
        id: lead.id,
        title: lead.businessName,
        subtitle: lead.contactName,
        path: `/leads/${lead.id}`,
      }));

    const clients = visibleClients
      .filter((client) => client.businessName.toLowerCase().includes(query))
      .slice(0, MAX_RESULTS_PER_GROUP)
      .map((client) => ({
        id: client.id,
        title: client.businessName,
        subtitle: client.ownerName,
        path: `/clients/${client.id}`,
      }));

    const invoices = visibleInvoices
      .filter((invoice) => invoice.invoiceNumber.toLowerCase().includes(query))
      .slice(0, MAX_RESULTS_PER_GROUP)
      .map((invoice) => {
        const client = allClients.find((candidate) => candidate.id === invoice.clientId);
        return {
          id: invoice.id,
          title: invoice.invoiceNumber,
          subtitle: client?.businessName || 'Unknown client',
          path: `/invoices/${invoice.id}`,
        };
      });

    return { leads, clients, invoices };
  }, [isOwner, searchQuery, user]);

  const totalResults =
    searchResults.leads.length + searchResults.clients.length + searchResults.invoices.length;
  const showDropdown = isSearchFocused && searchQuery.trim().length > 0;

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    onSearch?.(searchQuery);
  };

  const handleResultSelect = (path: string) => {
    navigate(path);
    setSearchQuery('');
    setIsSearchFocused(false);
  };

  const renderResultGroup = (
    groupTitle: string,
    icon: React.ReactNode,
    items: SearchItem[]
  ) => {
    if (items.length === 0) return null;
    return (
      <div className="py-1">
        <div className="flex items-center gap-2 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          <span>{groupTitle}</span>
        </div>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted/60"
            onMouseDown={(event) => {
              event.preventDefault();
              handleResultSelect(item.path);
            }}
          >
            <span className="text-sm font-medium">{item.title}</span>
            {item.subtitle && <span className="text-xs text-muted-foreground">{item.subtitle}</span>}
          </button>
        ))}
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-6">
      {/* Search */}
      <form onSubmit={handleSearch} className="hidden flex-1 md:block md:max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search leads, clients, invoices..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => {
              window.setTimeout(() => setIsSearchFocused(false), 120);
            }}
            className="w-full pl-9 input-enhanced"
          />
          {showDropdown && (
            <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-md border bg-popover shadow-lg">
              {totalResults === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">No matching results.</div>
              ) : (
                <>
                  {renderResultGroup('Leads', <Users className="h-3.5 w-3.5" />, searchResults.leads)}
                  {renderResultGroup('Clients', <Building2 className="h-3.5 w-3.5" />, searchResults.clients)}
                  {renderResultGroup('Invoices', <FileText className="h-3.5 w-3.5" />, searchResults.invoices)}
                </>
              )}
            </div>
          )}
        </div>
      </form>

      {/* Mobile spacer for menu button */}
      <div className="w-10 lg:hidden" />

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Theme Toggle */}
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
          {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-accent-foreground">
            3
          </span>
        </Button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 px-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <span className="text-xs font-medium">
                  {user?.name?.split(' ').map((token) => token[0]).join('') || 'U'}
                </span>
              </div>
              <div className="hidden text-left md:block">
                <p className="text-sm font-medium leading-none">{user?.name || 'User'}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role || 'Guest'}</p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{user?.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
