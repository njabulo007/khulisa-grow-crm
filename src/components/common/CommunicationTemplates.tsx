import { applyDraftOverride } from '@/lib/communicationOverrides';
import { settingsService } from '@/services/settingsService';
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  clientCareService,
  CHECKLIST_ITEMS,
} from "@/services/clientCareService";
import {
  COMMUNICATION_TEMPLATES,
  buildCommunicationDraft,
  hasDraftPlaceholders,
  whatsappRecipient,
  type CommunicationTemplate,
  type DraftInvoice,
} from "@/lib/communicationDrafts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
const selectStyle =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";
export function CommunicationTemplates({
  client,
  invoices,
}: {
  client: {
    id: string;
    businessName: string;
    ownerName: string;
    email: string;
    phone: string;
  };
  invoices: DraftInvoice[];
}) {
  const { user } = useAuth();
  const [template, setTemplate] = useState<CommunicationTemplate>("check-in");
  const [channel, setChannel] = useState("whatsapp");
  const [invoiceId, setInvoiceId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [prepared, setPrepared] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const key = JSON.stringify([
    client.id,
    template,
    template === "payment" ? invoiceId : "",
  ]);
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    setSubject("");
    setBody("");
    setPrepared("");
    setInvoiceId("");
    const invalidate = () => {
      generation.current++;
    };
    return invalidate;
  }, [client.id, user?.uid]);
  useEffect(() => {
    const grow = () => {
      const input = draftInput.current;
      if (!input) return;
      input.style.height = "auto";
      input.style.height = `${Math.max(256, input.scrollHeight)}px`;
    };
    grow();
    window.addEventListener("resize", grow);
    return () => window.removeEventListener("resize", grow);
  }, [body, channel]);
  const prepare = async () => {
    if (loading) return;
    const version = ++generation.current;
    const selection = key;
    setLoading(true);
    try {
      const materials =
        template === "missing-materials"
          ? (await clientCareService.get(client.id)).checklist
          : null;
      const draft = buildCommunicationDraft({
        template,
        clientName: client.businessName,
        contactName: client.ownerName,
        senderName: user?.name || "",
        missingMaterials: materials
          ? Object.entries(materials)
              .filter(([, item]) =>
                ["outstanding", "requested"].includes(item.status),
              )
              .map(
                ([name]) =>
                  CHECKLIST_ITEMS[name as keyof typeof CHECKLIST_ITEMS],
              )
          : [],
        invoice: invoices.find((invoice) => invoice.id === invoiceId),
      });
      if (version !== generation.current || selection !== currentKey.current)
        return;
      const settings=await settingsService.getGlobal();
      if (version !== generation.current || selection !== currentKey.current) return;
      const selectedInvoice=invoices.find(i=>i.id===invoiceId);
      const preparedDraft=applyDraftOverride(draft,settings.communicationTemplates?.[template],{clientName:client.businessName,contactName:client.ownerName,senderName:user?.name||'Khulisa Media',materials:materials?Object.entries(materials).filter(([,item])=>['outstanding','requested'].includes(item.status)).map(([name])=>CHECKLIST_ITEMS[name as keyof typeof CHECKLIST_ITEMS]).join('\n'):'',invoiceNumber:selectedInvoice?.invoiceNumber||'[Add invoice number]',outstanding:selectedInvoice?new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(selectedInvoice.outstanding):'[Add outstanding balance]',dueDate:selectedInvoice?.dueDate.slice(0,10)||'[Add due date]'});
      setSubject(preparedDraft.subject);
      setBody(preparedDraft.body);
      setPrepared(selection);
    } catch (e) {
      if (version === generation.current)
        toast.error(
          e instanceof Error ? e.message : "Could not prepare the draft.",
        );
    } finally {
      setLoading(false);
    }
  };
  const recipient = whatsappRecipient(client.phone || "");
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email || "");
  const paymentCurrent =
    template !== "payment" ||
    invoices.some(
      (invoice) => invoice.id === invoiceId && invoice.outstanding > 0,
    );
  const ready = Boolean(
    body.trim() &&
    prepared === key &&
    paymentCurrent &&
    !hasDraftPlaceholders(body) &&
    (channel !== "email" || !hasDraftPlaceholders(subject)),
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        channel === "email" ? `Subject: ${subject}\n\n${body}` : body,
      );
      toast.success("Draft copied.");
    } catch {
      toast.error(
        "Copy was unavailable. Select and copy the draft text instead.",
      );
    }
  };
  const href =
    channel === "email"
      ? `mailto:${encodeURIComponent(client.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      : `https://wa.me/${recipient}?text=${encodeURIComponent(body)}`;
  return (
    <Card id="client-templates" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Communication templates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Prepare and edit a draft before contacting the client. Opening
          WhatsApp or email starts a draft; you send it yourself. Draft edits
          stay here until you leave this page.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="communication-template">Template</Label>
            <select
              id="communication-template"
              className={selectStyle}
              value={template}
              onChange={(e) =>
                setTemplate(e.target.value as CommunicationTemplate)
              }
            >
              {Object.entries(COMMUNICATION_TEMPLATES).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="communication-channel">Channel</Label>
            <select
              id="communication-channel"
              className={selectStyle}
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </select>
          </div>
        </div>
        {template === "payment" && (
          <div className="space-y-2">
            <Label htmlFor="communication-invoice">Unpaid invoice</Label>
            <select
              id="communication-invoice"
              className={selectStyle}
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
            >
              <option value="">Select an invoice</option>
              {invoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.invoiceNumber} · R {invoice.outstanding.toFixed(2)}{" "}
                  outstanding
                </option>
              ))}
            </select>
            {!invoices.length && (
              <p className="text-sm text-muted-foreground">
                No unpaid sent invoices are available for this client.
              </p>
            )}
          </div>
        )}
        <Button
          variant="outline"
          disabled={loading || (template === "payment" && !invoiceId)}
          onClick={() => void prepare()}
        >
          {loading ? "Preparing draft…" : "Prepare draft"}
        </Button>
        {body && (
          <>
            {channel === "email" && (
              <div className="space-y-2">
                <Label htmlFor="communication-subject">Email subject</Label>
                <Input
                  id="communication-subject"
                  maxLength={300}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="communication-body">Editable message draft</Label>
              <Textarea
                ref={draftInput}
                id="communication-body"
                rows={12}
                className="min-h-64 resize-y overflow-hidden"
                maxLength={10000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            {prepared !== key && (
              <p className="text-sm text-warning-text">
                Prepare a new draft for the selected template or invoice.
              </p>
            )}
            {(hasDraftPlaceholders(body) ||
              (channel === "email" && hasDraftPlaceholders(subject))) && (
              <p className="text-sm text-warning-text">
                Replace the bracketed instructions before copying or opening the
                draft.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Recipient:{" "}
              {channel === "email"
                ? client.email || "No email recorded"
                : client.phone || "No phone recorded"}
              . Review dates, amounts, and wording before sending.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!ready} onClick={() => void copy()}>
                Copy draft
              </Button>
              {ready && (channel === "email" ? validEmail : recipient) ? (
                <Button variant="outline" asChild>
                  <a
                    href={href}
                    target={channel === "whatsapp" ? "_blank" : undefined}
                    rel="noopener noreferrer"
                  >
                    {channel === "email"
                      ? "Open email draft"
                      : "Open WhatsApp draft"}
                  </a>
                </Button>
              ) : (
                <Button variant="outline" disabled>
                  {channel === "email"
                    ? "Open email draft"
                    : "Open WhatsApp draft"}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
