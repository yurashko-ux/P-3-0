import {
  FundBootsSection,
  FundDonateBanner,
  FundHero,
  FundImportanceSection,
  FundMissionSection,
  FundProcessSection,
  FundReportsPreviewSection,
  FundRequisitesSection,
  FundStatsSection,
} from '@/components/fund/fund-site';

export default function FundHomePage() {
  return (
    <main>
      <FundHero />
      <FundMissionSection />
      <FundImportanceSection />
      <FundProcessSection />
      <FundBootsSection />
      <FundStatsSection />
      <FundReportsPreviewSection />
      <FundRequisitesSection />
      <FundDonateBanner />
    </main>
  );
}
