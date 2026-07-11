"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import FlameMascot, {
  type FlameMode,
} from "@/frontend/auth/flame-mascot";
import { ArrowIcon, Brand } from "@/frontend/auth/auth-visuals";
import {
  buildSavedRules,
  CONSENT_ITEMS,
  DEMO_PATTERNS,
  EMPTY_CONSENTS,
  type ConsentId,
  type ConsentState,
  type PatternId,
  type SavedDemoRule,
} from "./onboarding-data";
import styles from "./onboarding.module.css";

type OnboardingStep = "consent" | "patterns" | "rules" | "complete";

type OnboardingProgress = {
  schemaVersion: "v1";
  step: OnboardingStep;
  consents: ConsentState;
  selectedPatternIds: PatternId[];
  enabledRules: Partial<Record<PatternId, boolean>>;
  savedRules: SavedDemoRule[];
  completedAt: string | null;
};

const DEFAULT_PROGRESS: OnboardingProgress = {
  schemaVersion: "v1",
  step: "consent",
  consents: EMPTY_CONSENTS,
  selectedPatternIds: [],
  enabledRules: {},
  savedRules: [],
  completedAt: null,
};

function normalizeConsents(
  consents: Partial<ConsentState> | undefined,
): ConsentState {
  return {
    ...EMPTY_CONSENTS,
    ...consents,
  };
}

function normalizeProgress(progress: OnboardingProgress): OnboardingProgress {
  return {
    ...DEFAULT_PROGRESS,
    ...progress,
    consents: normalizeConsents(progress.consents),
  };
}

function onboardingStorageKey(userId: string) {
  return `fireguard:onboarding:v1:${userId}`;
}

function isOnboardingProgress(value: unknown): value is OnboardingProgress {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OnboardingProgress>;

  return (
    candidate.schemaVersion === "v1" &&
    ["consent", "patterns", "rules", "complete"].includes(
      candidate.step ?? "",
    ) &&
    Array.isArray(candidate.selectedPatternIds) &&
    Boolean(candidate.consents)
  );
}

function UiIcon({
  name,
}: {
  name:
    | "analytics"
    | "chart"
    | "check"
    | "clock"
    | "document"
    | "down"
    | "fire"
    | "info"
    | "lock"
    | "message"
    | "repeat"
    | "rocket"
    | "shield";
}) {
  const paths: Record<string, React.ReactNode> = {
    analytics: (
      <>
        <path d="M5 19V11m5 8V5m5 14v-6m5 6V8" />
        <path d="M3 19h18" />
      </>
    ),
    chart: (
      <>
        <path d="m4 16 5-5 4 3 7-8" />
        <path d="M16 6h4v4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    document: (
      <>
        <path d="M6 3h8l4 4v14H6Z" />
        <path d="M14 3v5h5M9 12h6m-6 4h6" />
      </>
    ),
    down: (
      <>
        <path d="m4 6 6 6 4-4 6 7" />
        <path d="M16 15h4v-4" />
      </>
    ),
    fire: (
      <path d="M12 3c1 4-3 5-3 9 0 2 1 3 2 3-1-3 2-4 3-6 0 3 4 4 4 8a6 6 0 0 1-12 0c0-6 5-8 6-14Z" />
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10v.1" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" />
      </>
    ),
    message: (
      <>
        <path d="M4 5h16v12H9l-5 4Z" />
        <path d="M8 9h8m-8 4h5" />
      </>
    ),
    repeat: (
      <>
        <path d="M5 8h11l-2-2m5 10H8l2 2" />
        <path d="M18 8a6 6 0 0 1 1 5M6 16a6 6 0 0 1-1-5" />
      </>
    ),
    rocket: (
      <>
        <path d="M14 4c3-1 5-1 6-1 0 1 0 3-1 6l-6 6-4-4Z" />
        <path d="m9 11-4 1-2 3 6 1 1 5 3-2v-4" />
        <circle cx="15.5" cy="7.5" r="1.5" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6Z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function StepProgress({
  current,
  label = "온보딩 단계",
}: {
  current: number;
  label?: string;
}) {
  return (
    <div className={styles.progress} aria-label={`${label} ${current}/3`}>
      <strong>
        {label} <em>{current}</em> / 3
      </strong>
      <span>
        {[1, 2, 3].map((step) => (
          <i key={step} className={step <= current ? styles.progressActive : ""} />
        ))}
      </span>
    </div>
  );
}

function ChoiceCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`${styles.choiceCheck} ${checked ? styles.choiceChecked : ""}`}
      aria-hidden="true"
    >
      {checked && <UiIcon name="check" />}
    </span>
  );
}

export default function OnboardingPage({ userId }: { userId: string }) {
  const router = useRouter();
  const [progress, setProgress] =
    useState<OnboardingProgress>(DEFAULT_PROGRESS);
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [openConsentId, setOpenConsentId] = useState<ConsentId | null>(null);
  const [openRuleId, setOpenRuleId] = useState<PatternId | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(onboardingStorageKey(userId));
    let restored = DEFAULT_PROGRESS;

    if (stored) {
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (isOnboardingProgress(parsed)) restored = normalizeProgress(parsed);
      } catch {
        window.localStorage.removeItem(onboardingStorageKey(userId));
      }
    }

    window.localStorage.setItem("fireguard:onboarding:active-user", userId);
    queueMicrotask(() => {
      setProgress(restored);
      setIsReady(true);
    });
  }, [userId]);

  useEffect(() => {
    if (!isReady) return;
    window.localStorage.setItem(
      onboardingStorageKey(userId),
      JSON.stringify(progress),
    );
  }, [isReady, progress, userId]);

  const selectedPatterns = useMemo(
    () =>
      DEMO_PATTERNS.filter((pattern) =>
        progress.selectedPatternIds.includes(pattern.id),
      ),
    [progress.selectedPatternIds],
  );

  function setStep(step: OnboardingStep) {
    setProgress((current) => ({ ...current, step }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateConsent(id: ConsentId, checked: boolean) {
    setProgress((current) => ({
      ...current,
      consents: {
        ...current.consents,
        [id]: checked,
      },
    }));
  }

  function toggleAllConsents(checked: boolean) {
    setProgress((current) => ({
      ...current,
      consents: Object.fromEntries(
        CONSENT_ITEMS.map((item) => [item.id, checked]),
      ) as ConsentState,
    }));
  }

  function togglePattern(id: PatternId) {
    setProgress((current) => {
      const selected = current.selectedPatternIds.includes(id);

      return {
        ...current,
        selectedPatternIds: selected
          ? current.selectedPatternIds.filter((patternId) => patternId !== id)
          : [...current.selectedPatternIds, id],
        enabledRules: {
          ...current.enabledRules,
          [id]: selected ? current.enabledRules[id] : true,
        },
      };
    });
  }

  function toggleRule(id: PatternId) {
    setProgress((current) => ({
      ...current,
      enabledRules: {
        ...current.enabledRules,
        [id]: !(current.enabledRules[id] ?? true),
      },
    }));
  }

  async function saveRules() {
    const savedRules = buildSavedRules(
      userId,
      progress.selectedPatternIds,
      progress.enabledRules,
    );
    const initialRules = savedRules.map(
      ({
        name,
        description,
        isEnabled,
        priority,
        riskLevel,
        visualMode,
        expression,
        warningTitle,
        warningMessage,
      }) => ({
        name,
        description,
        isEnabled,
        priority,
        riskLevel,
        visualMode,
        expression,
        warningTitle,
        warningMessage,
      }),
    );

    setIsSaving(true);
    setSaveMessage("");

    try {
      const response = await fetch("/api/me/onboarding/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          personalDataConsentVersion: "v1",
          initialRules,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        data?: { rules?: SavedDemoRule[] };
      } | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "규칙을 저장하지 못했습니다.");
      }

      setProgress((current) => ({
        ...current,
        step: "complete",
        savedRules: result.data?.rules?.length
          ? result.data.rules
          : savedRules,
        completedAt: new Date().toISOString(),
      }));
      window.localStorage.removeItem(onboardingStorageKey(userId));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setSaveMessage(
        error instanceof Error
          ? error.message
          : "규칙 저장 중 알 수 없는 오류가 발생했습니다.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (!isReady) {
    return (
      <main className={styles.onboardingPage}>
        <div className={`${styles.onboardingCard} ${styles.loadingCard}`}>
          <FlameMascot size={150} speed="slow" />
          <p>온보딩을 준비하고 있어요.</p>
        </div>
      </main>
    );
  }

  if (progress.step === "consent") {
    const requiredComplete = CONSENT_ITEMS.filter(
      (item) => item.required,
    ).every((item) => progress.consents[item.id]);
    const allChecked = CONSENT_ITEMS.every(
      (item) => progress.consents[item.id],
    );

    return (
      <main className={styles.onboardingPage}>
        <div className={styles.onboardingCard}>
          <header className={styles.topbar}>
            <Brand />
            <StepProgress current={1} label="동의 단계" />
          </header>

          <section className={styles.consentHeading}>
            <p>서비스를 시작하기 전에</p>
            <h1>
              <em>개인정보</em> 및 수집 데이터 동의
            </h1>
            <span>불씨가 어떤 데이터를 왜 사용하는지 투명하게 안내드릴게요.</span>
            <small>
              <UiIcon name="lock" />
              모든 데이터는 안전하게 보호되며 동의 없이 외부에 제공되지 않아요.
            </small>
          </section>

          <section className={styles.investmentNotice} aria-label="투자 보조도구 안내">
            <span>
              <UiIcon name="info" />
            </span>
            <p>
              <strong>불씨는 투자 자문 도구가 아닙니다.</strong>
              불씨는 투자 수익률을 높이거나 매수·매도 시점을 추천하지 않습니다.
              사용자가 직접 설정한 거래 규칙을 주문 직전에 다시 확인하도록 돕는
              개인 투자 보조 도구이며, 최종 투자 판단과 책임은 사용자에게 있습니다.
            </p>
          </section>

          <div className={styles.consentGrid}>
            <div className={styles.consentList}>
              {CONSENT_ITEMS.map((item) => {
                const open = openConsentId === item.id;
                const checked = Boolean(progress.consents[item.id]);

                return (
                  <div className={styles.consentItem} key={item.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          updateConsent(item.id, event.target.checked)
                        }
                      />
                      <ChoiceCheckbox checked={checked} />
                      <span className={styles.consentIcon}>
                        <UiIcon name={item.icon} />
                      </span>
                      <span className={styles.consentCopy}>
                        <strong>
                          {item.title}
                          <i>{item.required ? "(필수)" : "(선택)"}</i>
                        </strong>
                        <small>{item.summary}</small>
                      </span>
                    </label>
                    <button
                      className={styles.expandButton}
                      type="button"
                      onClick={() => setOpenConsentId(open ? null : item.id)}
                      aria-expanded={open}
                      aria-label={`${item.title} 상세 ${open ? "닫기" : "보기"}`}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m7 10 5 5 5-5" />
                      </svg>
                    </button>
                    {open && (
                      <div className={styles.consentDetail}>
                        {item.detailSections.map((section) => (
                          <section key={section.title}>
                            <strong>{section.title}</strong>
                            <ul>
                              {section.items.map((detail) => (
                                <li key={detail}>{detail}</li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <aside className={styles.privacyPanel}>
              <div className={styles.privacyVisual}>
                <FlameMascot mode="default" size={125} speed="slow" />
                <span className={styles.privacyShield}>
                  <UiIcon name="shield" />
                </span>
              </div>
              {[
                [
                  "chart",
                  "서버 저장",
                  "계정, 규칙, 주문 snapshot, 경고 반응, 거래 피드백",
                ],
                [
                  "fire",
                  "판정 목적",
                  "내가 설정한 규칙과 주문 직전 데이터를 비교해 알려줘요",
                ],
                [
                  "lock",
                  "로컬 보관",
                  "온보딩 진행 상태와 암호화된 업비트 API 키는 브라우저에 저장돼요",
                ],
                [
                  "clock",
                  "선택 처리",
                  "업비트 개인 API 데이터는 연결한 사용자에게만 적용돼요",
                ],
                [
                  "shield",
                  "사용자 권리",
                  "언제든 저장된 온보딩 설정을 다시 변경할 수 있어요",
                ],
              ].map(([icon, title, description]) => (
                <div className={styles.privacyRow} key={title}>
                  <span>
                    <UiIcon
                      name={
                        icon as "chart" | "fire" | "lock" | "clock" | "shield"
                      }
                    />
                  </span>
                  <p>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </p>
                </div>
              ))}
            </aside>
          </div>

          <div className={styles.consentActions}>
            <label className={styles.allConsent}>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(event) => toggleAllConsents(event.target.checked)}
              />
              <ChoiceCheckbox checked={allChecked} />
              <span>
                <strong>전체 동의</strong>
                <small>위의 모든 항목에 동의합니다.</small>
              </span>
            </label>
            <div>
              {!requiredComplete && (
                <span className={styles.actionHint}>필수 항목을 확인해 주세요.</span>
              )}
              <button
                className={styles.primaryButton}
                type="button"
                disabled={!requiredComplete}
                onClick={() => setStep("patterns")}
              >
                동의하고 계속하기
                <ArrowIcon />
              </button>
            </div>
          </div>

          <SecurityFooter />
        </div>
      </main>
    );
  }

  if (progress.step === "patterns") {
    const latestPattern =
      DEMO_PATTERNS.find(
        (pattern) =>
          pattern.id ===
          progress.selectedPatternIds[progress.selectedPatternIds.length - 1],
      ) ?? DEMO_PATTERNS[0];

    return (
      <main className={styles.onboardingPage}>
        <div className={styles.onboardingCard}>
          <header className={styles.topbar}>
            <Brand />
            <StepProgress current={2} />
          </header>

          <section className={styles.patternHeading}>
            <p>나를 더 잘 이해하면, 더 좋은 투자가 가능해요.</p>
            <h1>
              어떤 거래를 가장 <em>후회했나요?</em>
            </h1>
            <span>
              해당하는 상황을 모두 골라주세요.
              <br />
              선택한 답변을 바탕으로 나만의 규칙을 제안해드릴게요.
            </span>
          </section>

          <div className={styles.patternLayout}>
            <div className={styles.patternMascot}>
              <FlameMascot
                mode={latestPattern.flameMode}
                size="clamp(170px, 19vw, 255px)"
              />
              <span>복수 선택할 수 있어요</span>
            </div>

            <div
              className={styles.patternCards}
              role="group"
              aria-label="후회한 거래 패턴"
            >
              {DEMO_PATTERNS.map((pattern) => {
                const checked = progress.selectedPatternIds.includes(pattern.id);

                return (
                  <label
                    className={`${styles.patternCard} ${
                      checked ? styles.patternCardSelected : ""
                    }`}
                    key={pattern.id}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePattern(pattern.id)}
                    />
                    <span className={styles.patternIcon}>
                      <UiIcon name={pattern.icon} />
                    </span>
                    <span>
                      <strong>{pattern.title}</strong>
                      <small>{pattern.sentence}</small>
                    </span>
                    <ChoiceCheckbox checked={checked} />
                  </label>
                );
              })}
            </div>
          </div>

          <div className={styles.patternFooter}>
            <p>
              <UiIcon name="shield" />
              선택한 답변은 개인 규칙 제안 목적으로만 사용되며 외부에 공유되지
              않아요.
            </p>
            <div>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setStep("consent")}
              >
                이전
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={progress.selectedPatternIds.length === 0}
                onClick={() => setStep("rules")}
              >
                다음
                <ArrowIcon />
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (progress.step === "rules") {
    const mascotMode: FlameMode = selectedPatterns[0]?.flameMode ?? "default";

    return (
      <main className={styles.onboardingPage}>
        <div className={styles.onboardingCard}>
          <header className={styles.topbar}>
            <Brand />
            <StepProgress current={3} />
          </header>

          <div className={styles.ruleLayout}>
            <section className={styles.ruleMain}>
              <p className={styles.ruleKicker}>선택한 패턴을 바탕으로 만들었어요</p>
              <h1>
                당신에게 맞는 <em>개인 규칙</em>을 제안했어요
              </h1>
              <span>
                규칙을 눌러 판정 조건과 설명을 확인하세요.
                <br />
                저장 전 각 규칙을 켜거나 끌 수 있어요.
              </span>

              <div className={styles.ruleList}>
                {selectedPatterns.map((pattern) => {
                  const enabled = progress.enabledRules[pattern.id] ?? true;
                  const open = openRuleId === pattern.id;

                  return (
                    <article
                      className={`${styles.ruleCard} ${
                        !enabled ? styles.ruleDisabled : ""
                      }`}
                      key={pattern.id}
                    >
                      <button
                        className={styles.ruleSummary}
                        type="button"
                        onClick={() => setOpenRuleId(open ? null : pattern.id)}
                        aria-expanded={open}
                      >
                        <span className={styles.ruleIcon}>
                          <UiIcon name={pattern.icon} />
                        </span>
                        <span>
                          <strong>{pattern.ruleName}</strong>
                          <small>{pattern.ruleSummary}</small>
                        </span>
                        <i className={styles.riskBadge}>
                          {pattern.riskLevel === "HIGH" ? "높은 위험" : "주의"}
                        </i>
                        <svg
                          className={styles.chevron}
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path d="m7 10 5 5 5-5" />
                        </svg>
                      </button>

                      <button
                        className={`${styles.ruleToggle} ${
                          enabled ? styles.ruleToggleOn : ""
                        }`}
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`${pattern.ruleName} ${
                          enabled ? "비활성화" : "활성화"
                        }`}
                        onClick={() => toggleRule(pattern.id)}
                      >
                        <span />
                      </button>

                      {open && (
                        <div className={styles.ruleDetail}>
                          <div className={styles.expression}>
                            <div>
                              <strong>판정 조건</strong>
                              {pattern.requiresPrivateApi && (
                                <span>
                                  <UiIcon name="lock" />
                                  개인 API 필요
                                </span>
                              )}
                            </div>
                            <code>
                              {pattern.expressionText.map((line, index) => (
                                <span key={line}>
                                  {index > 0 && <b>AND </b>}
                                  {line}
                                </span>
                              ))}
                            </code>
                          </div>
                          <div className={styles.explanations}>
                            <strong>이 조건은 이렇게 판단해요</strong>
                            {pattern.explanations.map((explanation) => (
                              <p key={explanation.term}>
                                <b>{explanation.term}</b>
                                <span>{explanation.description}</span>
                              </p>
                            ))}
                          </div>
                          <div className={styles.warningPreview}>
                            <span>
                              <UiIcon name="message" />
                            </span>
                            <p>
                              <strong>{pattern.warningTitle}</strong>
                              <small>{pattern.warningMessage}</small>
                            </p>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <p className={styles.ruleNote}>
                <UiIcon name="info" />
                저장하면 내 계정의 실제 가드레일 규칙으로 등록되고, 확장
                프로그램이 이 규칙을 불러와 주문 화면에서 판정합니다.
              </p>
              {saveMessage ? (
                <p className={styles.ruleNote} role="status">
                  <UiIcon name="info" />
                  {saveMessage}
                </p>
              ) : null}
            </section>

            <aside className={styles.ruleAside}>
              <div className={styles.selectedPanel}>
                <strong>선택한 패턴</strong>
                {selectedPatterns.map((pattern) => (
                  <span key={pattern.id}>
                    <i>
                      <UiIcon name={pattern.icon} />
                    </i>
                    {pattern.title}
                  </span>
                ))}
              </div>
              <FlameMascot mode={mascotMode} size={210} />
            </aside>
          </div>

          <div className={styles.ruleActions}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => setStep("patterns")}
            >
              패턴 다시 선택
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={saveRules}
              disabled={isSaving}
            >
              {isSaving ? "규칙 저장 중..." : "규칙 저장하기"}
              <ArrowIcon />
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.onboardingPage}>
      <div className={`${styles.onboardingCard} ${styles.completeCard}`}>
        <header className={styles.topbar}>
          <Brand />
        </header>

        <section className={styles.completeContent}>
          <p>준비가 끝났어요</p>
          <h1>
            이제 <em>직접 사용</em>해보세요!
          </h1>
          <span>
            불씨가 당신의 투자 습관을 더 차분하게 지켜드릴게요.
            <br />
            지금 바로 시작해보세요.
          </span>

          <div className={styles.completeVisual}>
            <FlameMascot size="clamp(210px, 25vw, 330px)" />
          </div>

          <div className={styles.completeBadges}>
            <span>
              <UiIcon name="check" />
              개인 규칙 {progress.savedRules.length}개 저장
            </span>
            <span>
              <UiIcon name="shield" />
              필수 동의 완료
            </span>
            <span>
              <UiIcon name="fire" />
              온보딩 완료
            </span>
          </div>

          <button
            className={`${styles.primaryButton} ${styles.startButton}`}
            type="button"
            onClick={() => {
              router.replace("/dashboard");
            }}
          >
            시작하기
            <ArrowIcon />
          </button>
          <button
            className={styles.reviewButton}
            type="button"
            onClick={() => setStep("rules")}
          >
            규칙 다시 보기
          </button>
        </section>

        <SecurityFooter />
      </div>
    </main>
  );
}

function SecurityFooter() {
  return (
    <footer className={styles.securityFooter}>
      <span>
        <UiIcon name="shield" />
        <strong>안전한 데이터 보호</strong>
        <small>HttpOnly 세션 쿠키로 계정을 보호해요</small>
      </span>
      <i />
      <span>
        <UiIcon name="lock" />
        <strong>제3자 제공 금지</strong>
        <small>사용자 동의 없이 외부 제공하지 않아요</small>
      </span>
      <i />
      <span>
        <UiIcon name="check" />
        <strong>투명한 설정</strong>
        <small>선택한 규칙을 언제든 확인할 수 있어요</small>
      </span>
    </footer>
  );
}
