import AiRiskCard from "../components/AiRiskCard";
import CTASection from "../components/CTASection";
import DashboardPreview from "../components/DashboardPreview";
import FeaturesSection from "../components/FeaturesSection";
import HeroSection from "../components/HeroSection";
import Navbar from "../components/Navbar";
import TrustSection from "../components/TrustSection";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        <HeroSection />
        <TrustSection />
        <FeaturesSection />
        <AiRiskCard />
        <DashboardPreview />
        <CTASection />
      </main>
    </>
  );
}
