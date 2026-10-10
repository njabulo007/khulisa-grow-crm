export const healthTone = (status?: string) =>
  status === "healthy"
    ? "bg-success/10 text-success-text"
    : status === "at-risk"
      ? "bg-destructive/10 text-destructive-text"
      : status === "needs-attention"
        ? "bg-warning/10 text-warning-text"
        : "bg-muted text-muted-foreground";
