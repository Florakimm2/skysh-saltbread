import { TrendIcon } from "./icons";
import PlaceholderPage from "./placeholder-page";

export default function PastTrendsPage() {
  return (
    <PlaceholderPage
      eyebrow="History"
      title="과거 경향"
      description="누적된 기록을 바탕으로 나의 투자 흐름을 살펴보세요."
      panelTitle="투자 경향"
      emptyTitle="과거 경향 페이지를 준비하고 있습니다"
      emptyDescription="기간별 투자 습관과 변화 추이를 확인할 수 있는 분석 화면이 이곳에 제공됩니다."
      icon={<TrendIcon />}
    />
  );
}
