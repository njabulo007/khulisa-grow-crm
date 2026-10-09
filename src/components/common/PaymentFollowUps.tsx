import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { paymentFollowUpService, paymentFollowUpToday, type PaymentFollowUp } from '@/services/paymentFollowUpService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NoteEditor } from './NoteEditor';
import { NoteContent } from './NoteContent';
import { toast } from 'sonner';

export function PaymentFollowUps({ invoiceId, clientId, payable = true }: { invoiceId?: string; clientId?: string; payable?: boolean }) {
  const { user } = useAuth();
  const [records, setRecords] = useState<PaymentFollowUp[]>([]);
  const [date, setDate] = useState(paymentFollowUpToday);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [backgroundConfigured, setBackgroundConfigured] = useState(true);
  const latest = useRef(0);
  useEffect(() => {
    if (invoiceId && window.location.hash === '#payment-follow-up') {
      document.getElementById('payment-follow-up')?.scrollIntoView({ block: 'start' });
    }
  }, [invoiceId]);
  const invalidate = useCallback(() => { latest.current++; }, []);
  const load = useCallback(async (fillForm = false) => {
    const version = ++latest.current;
    try {
      const data = await paymentFollowUpService.list(invoiceId);
      if (version !== latest.current) return;
      setRecords(data.followUps);
      setBackgroundConfigured(data.backgroundConfigured);
      setError('');
      if (fillForm) { setDate(data.followUps[0]?.followUpDate || paymentFollowUpToday()); setNotes(data.followUps[0]?.notes || ''); }
    } catch (error) {
      if (version === latest.current) setError(error instanceof Error ? error.message : 'Follow-ups could not be loaded.');
    } finally { if (version === latest.current) setLoading(false); }
  }, [invoiceId]);

  useEffect(() => {
    setLoading(true); setRecords([]); setError('');
    void load(true);
    return invalidate;
  }, [load, invalidate, user?.uid, user?.id, payable]);

  const save = async () => {
    if (!invoiceId || saving) return;
    setSaving(true);
    try {
      await paymentFollowUpService.save(invoiceId, date, notes);
      toast.success('Payment follow-up scheduled.');
      // A failed delivery must not misreport the durable schedule as unsaved.
      void paymentFollowUpService.check().catch(error => console.error('[Payment follow-up] Notification check failed.', error));
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Follow-up could not be saved.'); }
    finally { setSaving(false); }
  };

  const cancel = async () => {
    if (!invoiceId || saving) return;
    setSaving(true);
    try {
      await paymentFollowUpService.cancel(invoiceId);
      setNotes(''); setDate(paymentFollowUpToday());
      await load(); toast.success('Payment reminders stopped.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Reminder could not be stopped.'); }
    finally { setSaving(false); }
  };

  return (
    <Card id="payment-follow-up">
      <CardHeader>
        <CardTitle className="text-lg">{invoiceId ? 'Payment follow-up' : 'My payment follow-ups'}</CardTitle>
        <p className="text-sm text-muted-foreground">Reminders for your unpaid invoices. Paid invoices stop generating reminders automatically.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
        {!loading && !backgroundConfigured && <p className="rounded-lg border p-3 text-sm text-muted-foreground">Daily background reminders are awaiting owner setup. The CRM also checks your due follow-ups when you open it.</p>}
        {loading ? <p className="text-sm text-muted-foreground">Loading follow-ups…</p> : invoiceId ? (
          payable ? <div className="space-y-3">
            {records[0] && <p className="text-sm font-medium">{records[0].followUpDate <= paymentFollowUpToday() ? 'Follow-up due' : 'Next follow-up'}: {records[0].followUpDate}</p>}
            <div className="space-y-2">
              <Label htmlFor="payment-follow-up-date">Follow-up date</Label>
              <Input id="payment-follow-up-date" type="date" value={date} disabled={saving} onChange={event => setDate(event.target.value)} className="max-w-xs" />
            </div>
            <NoteEditor label="Payment follow-up notes" value={notes} onChange={setNotes} maxLength={4000} disabled={saving} placeholder="Client response, promise to pay, and next action…" />
            <p className="text-xs text-muted-foreground">Remind me daily from this date until paid or stopped. Background checks run around 09:00 South African time. These reminders go to you; contact the client separately.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={saving || !date}>{saving ? 'Saving…' : records[0] ? 'Update follow-up' : 'Schedule follow-up'}</Button>
              {records[0] && <Button variant="outline" disabled={saving} onClick={() => void cancel()}>Stop reminders</Button>}
              {clientId && <Button asChild variant="outline"><Link to={`/clients/${encodeURIComponent(clientId)}`}>Log client contact</Link></Button>}
            </div>
          </div> : <p className="text-sm text-muted-foreground">No reminder is needed for a settled or draft invoice.</p>
        ) : records.length ? (
          <ul className="space-y-3">
            {records.map(record => <li key={record.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-medium">{record.clientName} · {record.invoiceNumber}</p>
                  <p className={`text-sm ${record.followUpDate <= paymentFollowUpToday() ? 'text-destructive-text' : 'text-muted-foreground'}`}>{record.followUpDate <= paymentFollowUpToday() ? 'Due now' : 'Upcoming'} · {record.followUpDate} · R {record.balance.toFixed(2)} outstanding</p>
                </div>
                <Button asChild size="sm" variant="outline"><Link to={`/invoices/${encodeURIComponent(record.invoiceId)}#payment-follow-up`}>Open follow-up</Link></Button>
              </div>
              {record.notes && <NoteContent text={record.notes} className="mt-3" />}
            </li>)}
          </ul>
        ) : <p className="text-sm text-muted-foreground">No payment follow-ups scheduled. Open an unpaid invoice to set one.</p>}
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading || saving}>Refresh follow-ups</Button>
      </CardContent>
    </Card>
  );
}
