import AiRiskCard from "../components/AiRiskCard";
import AboutSection from "../components/AboutSection";
import CTASection from "../components/CTASection";
import DashboardPreview from "../components/DashboardPreview";
import FeaturesSection from "../components/FeaturesSection";
import HeroSection from "../components/HeroSection";
import HowItWorksSection from "../components/HowItWorksSection";
import Navbar from "../components/Navbar";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
        <AiRiskCard />
        <DashboardPreview />
        <CTASection />
        <AboutSection />
      </main>
    </>
  );
}
