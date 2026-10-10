import { PageHeader } from "@/components/common";
import { ClientFollowUps } from "@/components/common/ClientFollowUps";
import { ClientRequests } from "@/components/common/ClientRequests";
import { ClientHealthOverview } from "@/components/common/ClientHealthOverview";
import { ClientGrowth } from "@/components/common/ClientGrowth";
export function ClientSuccessPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Success"
        description="Keep client conversations and delivery requests moving."
      />
      <ClientHealthOverview />
      <ClientFollowUps />
      <ClientRequests />
      <ClientGrowth />
    </div>
  );
}
