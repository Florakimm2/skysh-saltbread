import { SparklesIcon } from "./icons";
import PlaceholderPage from "./placeholder-page";

export default function AiInsightsPage() {
  return (
    <PlaceholderPage
      eyebrow="Intelligence"
      title="AI 인사이트"
      description="투자 기록 속에서 놓치기 쉬운 패턴을 AI와 함께 발견하세요."
      panelTitle="AI 분석"
      emptyTitle="AI 인사이트 페이지를 준비하고 있습니다"
      emptyDescription="투자 패턴을 바탕으로 생성된 맞춤형 인사이트가 이곳에 제공됩니다."
      icon={<SparklesIcon />}
    />
  );
}
