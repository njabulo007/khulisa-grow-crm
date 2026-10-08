# Invoice review

Reviewed the invoice detail page and printable/PDF template. This is a template review with representative test records, not a review of a particular live customer invoice or bank verification.

## Information present

- Company logo, legal account-holder/company name, existing company registration number, email, website and telephone.
- Client business name, contact name, email, telephone and location when populated.
- Invoice number, issue date, due date and status.
- Service descriptions, quantities, unit prices and line totals.
- Subtotal, total, recorded payments and balance due in ZAR.
- Payment reference and optional notes/payment terms.
- Project/service information when linked or supplied.

## Improvements implemented

Replaced the old Capitec payment instructions with the owner's first supplied details: Standard Bank; branch code 4806; account holder KHULISA MEDIA (PTY) LTD; account number 10 28 786 999 5; account type CURRENT. No branch name or additional account-holder wording from the later message is used.

The invoice detail and printed/PDF view share one account-details component and configuration. Payment reference is shown with the bank details. Printed currency uses two decimal places. Empty project information and internal project IDs are removed from customer-facing output. Print styling keeps the payment summary alongside the banking section and reduces awkward page breaks. The automatic print dialog now waits until client and payment records have finished loading.

The template has a professional structure: clear issuer/client blocks, invoice metadata, item table, payment instructions and a separate summary. Long or numerous items/notes can still span pages.

## Gaps and issues to resolve

1. The issuer's street/postal address is absent. Client location is only shown if populated, and is not a structured billing address. Add the company's actual address and populate client billing details rather than inventing them.
2. VAT registration status is not established. The current template has no VAT registration number, rate or VAT breakdown; legacy tax fields are ignored by current calculations. If the business is VAT-registered, VAT support needs a separate implementation and review before using this as a tax invoice. Do not invent a VAT number or assume registration.
3. Package-linked totals use the currently configured project's package price, whereas the displayed line items are saved on the invoice. A changed package or price can make these disagree or alter historical invoice totals. Pricing calculations are preserved in this change; this should be addressed separately using an agreed invoice snapshot policy and existing-record validation.
4. Optional payment terms and service descriptions depend on what was entered for each invoice. Due date and invoice payment reference are already present; specific deposit, installment, cancellation or late-payment terms must reflect the actual customer agreement.

The supplied bank details are displayed exactly. This code review does not independently validate the account or branch code against Standard Bank. Existing company registration/contact details come from the repository and were not independently verified.

## Validation

TypeScript, lint and production build checks, plus browser checks for owner and agent invoice access, bank details, partial-payment totals, mobile layout and delayed data loading before printing. A4 PDF output was generated for visual inspection. Browser data is mocked; production records and real payment processing were not changed or tested.
