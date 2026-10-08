import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Lead } from '@/types/models';
import { leadFollowUpService } from '@/services/leadFollowUpService';
import { paymentFollowUpService, paymentFollowUpToday } from '@/services/paymentFollowUpService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NoteEditor } from './NoteEditor';

export function LeadFollowUpPanel({ lead, onSaved }: { lead: Lead; onSaved: () => Promise<void> }) {
  const [date, setDate] = useState(lead.followUpDate?.slice(0, 10) || '');
  const [notes, setNotes] = useState('');
  const [type, setType] = useState('call');
  const [another, setAnother] = useState(false);
  const [nextDate, setNextDate] = useState('');
  const [busy, setBusy] = useState(false);
  const retry = useRef<{ signature: string; id: string }>();
  const closed = ['won', 'lost'].includes(lead.stage);
  useEffect(() => { setDate(lead.followUpDate?.slice(0, 10) || ''); }, [lead.followUpDate]);

  const save = async (complete: boolean, stop = false) => {
    if (busy) return;
    setBusy(true);
    try {
      if (complete) {
        const signature = JSON.stringify([type, notes.trim(), another ? nextDate : '']);
        if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() };
        await leadFollowUpService.complete(lead.id, type, notes.trim(), another ? nextDate : '', retry.current.id);
        retry.current = undefined;
        setNotes(''); setAnother(false); setNextDate('');
      } else {
        await leadFollowUpService.save(lead.id, stop ? '' : date);
      }
      toast.success(complete ? 'Follow-up recorded' : stop ? 'Follow-up reminders stopped' : 'Follow-up date saved');
      await onSaved();
      void paymentFollowUpService.check().catch(() => {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Follow-up could not be saved. Please retry.');
    } finally { setBusy(false); }
  };

  return <Card>
    <CardHeader><CardTitle>Lead follow-ups</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm text-muted-foreground">{lead.followUpCount || 0} completed follow-ups. Each outcome stays in the activity history.</p>
      {closed ? <p className="text-sm text-muted-foreground">Acquisition reminders stop for won or lost leads.</p> : <>
        <p className="text-sm text-muted-foreground">Reminders go to the assigned agent from the due date onward, including when the PWA is closed and push is enabled.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">Current follow-up date
            <Input aria-label="Current follow-up date" type="date" value={date} disabled={busy} onChange={e => setDate(e.target.value)} />
          </label>
          <Button variant="outline" disabled={busy || !date || date === lead.followUpDate?.slice(0, 10)} onClick={() => void save(false)}>Save date</Button>
          {lead.followUpDate && <Button variant="ghost" disabled={busy} onClick={() => void save(false, true)}>Stop reminders</Button>}
        </div>
        {lead.followUpDate && <p className="text-sm font-medium">{lead.followUpDate.slice(0, 10) < paymentFollowUpToday() ? 'Overdue' : lead.followUpDate.slice(0, 10) === paymentFollowUpToday() ? 'Due today' : 'Upcoming'}: {lead.followUpDate.slice(0, 10)}</p>}
        <div className="border-t pt-5 space-y-4">
          <h3 className="font-medium">Record follow-up {(lead.followUpCount || 0) + 1}</h3>
          <label className="block text-sm space-y-1">Contact method
            <select aria-label="Follow-up contact method" className="flex h-10 rounded-md border bg-background px-3" value={type} disabled={busy} onChange={e => setType(e.target.value)}>
              <option value="call">Call</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="meeting">Meeting</option><option value="note">Note</option>
            </select>
          </label>
          <NoteEditor label="Follow-up outcome" value={notes} onChange={setNotes} maxLength={10000} disabled={busy} placeholder="What happened? Record the client's response and any next steps..." />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={another} disabled={busy} onChange={e => setAnother(e.target.checked)} />Schedule another follow-up</label>
          {another && <label className="block text-sm space-y-1">Next follow-up date<Input aria-label="Next follow-up date" type="date" value={nextDate} disabled={busy} onChange={e => setNextDate(e.target.value)} /></label>}
          {!another && <p className="text-sm text-muted-foreground">Saving this outcome clears the reminder date. You can schedule another later.</p>}
          <Button disabled={busy || !notes.trim() || (another && !nextDate)} onClick={() => void save(true)}>{busy ? 'Saving...' : 'Complete follow-up'}</Button>
        </div>
      </>}
      {closed && lead.followUpDate && <Button variant="outline" disabled={busy} onClick={() => void save(false, true)}>Clear old follow-up date</Button>}
    </CardContent>
  </Card>;
}
