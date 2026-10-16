// Shared question definitions: public form and server validation use the same fields.
export const ONBOARDING_STATES = {
  "not-started": "Not Started",
  "in-progress": "In Progress",
  submitted: "Submitted",
  "under-review": "Under Review",
  "more-information-needed": "More Information Needed",
  approved: "Approved",
};
export const BUSINESS_FIELDS = [
  { id: "businessName", label: "Business name", required: true },
  {
    id: "businessDescription",
    label: "What does your business do?",
    required: true,
    multiline: true,
  },
  { id: "contactName", label: "Your name", required: true },
  { id: "contactEmail", label: "Contact email", type: "email" },
  { id: "contactPhone", label: "Contact phone" },
  { id: "location", label: "Business location or area served", required: true },
  { id: "hours", label: "Operating hours" },
  {
    id: "productsServices",
    label: "Your main services or products",
    required: true,
    multiline: true,
  },
  {
    id: "customers",
    label: "Who are your customers?",
    required: true,
    multiline: true,
  },
  {
    id: "socialProfiles",
    label: "Social media pages (optional)",
    multiline: true,
  },
  { id: "existingWebsite", label: "Existing website (optional)", type: "url" },
  {
    id: "preferredContact",
    label: "Preferred contact method",
    options: ["WhatsApp", "Email", "Phone call"],
    required: true,
  },
  { id: "brandColours", label: "Brand colours or colour preferences" },
];
export const ONBOARDING_TEMPLATES = {
  website: {
    label: "Website",
    minutes: 10,
    fields: [
      {
        id: "websiteGoals",
        label: "What should your website achieve?",
        required: true,
        multiline: true,
      },
      {
        id: "websitePages",
        label: "Pages or sections you need",
        required: true,
        multiline: true,
      },
      { id: "websiteStyle", label: "Preferred design style" },
      {
        id: "websiteReferences",
        label: "Websites you like (optional)",
        multiline: true,
      },
      {
        id: "websiteFeatures",
        label: "Important website features",
        multiline: true,
      },
      {
        id: "websiteAction",
        label: "What should a visitor do first?",
        required: true,
      },
    ],
  },
  shop: {
    label: "Mini online shop",
    minutes: 12,
    fields: [
      {
        id: "shopProducts",
        label: "Products, categories and prices",
        required: true,
        multiline: true,
      },
      { id: "shopImages", label: "Do you have product images?" },
      {
        id: "shopStock",
        label: "How do you manage stock?",
        required: true,
        multiline: true,
      },
      {
        id: "shopPayments",
        label: "Preferred ways for customers to pay",
        required: true,
      },
      {
        id: "shopDelivery",
        label: "Delivery or collection arrangements",
        required: true,
        multiline: true,
      },
    ],
  },
  automation: {
    label: "Business automation",
    minutes: 15,
    fields: [
      {
        id: "automationProcess",
        label: "Describe your current process",
        required: true,
        multiline: true,
      },
      {
        id: "automationProblems",
        label: "What problems should we solve?",
        required: true,
        multiline: true,
      },
      {
        id: "automationWorkflow",
        label: "How should the new workflow work?",
        required: true,
        multiline: true,
      },
      {
        id: "automationRoles",
        label: "Who will use it, and what should each person do?",
        required: true,
        multiline: true,
      },
      { id: "automationReports", label: "Reports you need", multiline: true },
      {
        id: "automationMigration",
        label: "Existing information that needs moving (no passwords)",
        multiline: true,
      },
    ],
  },
  branding: {
    label: "Branding",
    minutes: 8,
    fields: [
      {
        id: "brandPersonality",
        label: "How should your brand feel?",
        required: true,
        multiline: true,
      },
      {
        id: "brandReferences",
        label: "Logo or design references",
        multiline: true,
      },
      {
        id: "brandAssets",
        label: "Design items you need",
        required: true,
        multiline: true,
      },
    ],
  },
};
export const templateIdsFor = (project) =>
  Array.isArray(project.onboardingTemplateIds)
    ? project.onboardingTemplateIds.filter((id) =>
        Object.hasOwn(ONBOARDING_TEMPLATES, id),
      )
    : [
          "digital-starter-presence",
          "local-growth-engine",
          "business-brand-expansion",
        ].includes(project.packageId)
      ? ["website"]
      : [];
export const onboardingFields = (ids) => [
  ...BUSINESS_FIELDS,
  ...ids.flatMap((id) => ONBOARDING_TEMPLATES[id]?.fields || []),
];
export const missingOnboardingFields = (answers, ids) => {
  const missing = onboardingFields(ids)
    .filter((f) => f.required && !answers[f.id]?.trim())
    .map((f) => f.label);
  if (!answers.contactEmail?.trim() && !answers.contactPhone?.trim())
    missing.push("Contact email or phone");
  return missing;
};
