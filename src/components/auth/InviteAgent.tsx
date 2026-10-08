import { useState } from 'react';
import { AuthService } from '@/services/authService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export function InviteAgent() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [invitation, setInvitation] = useState<{ email: string; setupLink: string } | null>(null);
  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setInvitation(null);
    try {
      setInvitation(await AuthService.inviteAgent(email, name));
      toast.success('Invitation ready. Share the private setup link with this person.');
      window.dispatchEvent(new CustomEvent('crm:data-changed'));
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Invitation could not be created.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4 rounded-lg border p-4">
    <div><h3 className="font-medium">Invite an agent</h3><p className="text-sm text-muted-foreground">Create access for someone you trust. They choose their own password using a private setup link.</p></div>
    <form onSubmit={invite} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="invite-name">Full name</Label><Input id="invite-name" value={name} maxLength={120} autoComplete="off" required disabled={busy} onChange={e => setName(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="invite-email">Email</Label><Input id="invite-email" type="email" value={email} maxLength={254} autoComplete="off" required disabled={busy} onChange={e => setEmail(e.target.value)} /></div>
      <Button type="submit" disabled={busy || !name.trim() || !email.trim()} className="sm:col-span-2 sm:justify-self-start">{busy ? 'Creating invitation...' : 'Create invitation'}</Button>
    </form>
    {invitation && <div className="space-y-2 rounded-md bg-muted p-3">
      <p className="text-sm font-medium">Setup link for {invitation.email}</p>
      <Input aria-label="Private invitation setup link" readOnly value={invitation.setupLink} onFocus={e => e.target.select()} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(invitation.setupLink).then(() => toast.success('Setup link copied')).catch(() => toast.error('Select and copy the link manually.')); }}>Copy setup link</Button>
        <Button variant="ghost" onClick={() => setInvitation(null)}>Hide link</Button>
      </div>
      <p className="text-xs text-muted-foreground">Share it privately with this person. No email is sent automatically. After choosing a password, they log in at the CRM. If the link expires before their first login, create an invitation for the same email again.</p>
    </div>}
  </div>;
}
