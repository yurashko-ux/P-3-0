"use client";

import { Suspense } from "react";
import { InactiveBaseCampaignsPanel } from "../_components/InactiveBaseCampaignsPanel";

function CampaignsPageContent() {
  return <InactiveBaseCampaignsPanel />;
}

export default function InactiveBaseCampaignsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-base-200 flex items-center justify-center text-sm opacity-70">
          Завантаження…
        </div>
      }
    >
      <CampaignsPageContent />
    </Suspense>
  );
}
