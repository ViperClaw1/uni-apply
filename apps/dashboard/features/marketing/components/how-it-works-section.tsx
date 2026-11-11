"use client";

import { useRef } from "react";
import { useT } from "@/lib/i18n/context";
import { HOW_IT_WORKS_SLIDES, type HowItWorksSlide } from "../constants/how-it-works";
import { useHiwScrollLock } from "../hooks/use-hiw-scroll-lock";

const MOCK_UNIVERSITIES = [
  { name: "Peking University", picked: true },
  { name: "Nanjing University", picked: true },
  { name: "Sichuan University", picked: true },
  { name: "Beijing University of Technology", picked: false },
];
const APPLY_UNIVERSITY_COUNT = 3;
const STEP_COUNT = HOW_IT_WORKS_SLIDES.length;

export function HowItWorksSection() {
  const t = useT();
  const sectionRef = useRef<HTMLElement>(null);
  const { step, ready, reducedMotion, bindRoot } = useHiwScrollLock(sectionRef, STEP_COUNT);

  return (
    <section id="how-it-works" ref={sectionRef} className="border-t border-slate-100 bg-white">
      <div
        ref={bindRoot}
        data-hiw-root="pin"
        data-hiw-ready={ready}
        className="flex h-svh flex-col justify-center"
      >
        <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:py-16">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100">
              {t.landing.howItWorks.badge}
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-950">
              {t.landing.howItWorks.title}
            </h2>
            <p className="mt-3 text-base leading-7 text-slate-500">
              {t.landing.howItWorks.description}
            </p>
          </div>

          <div className="mt-10 grid items-center gap-10 lg:grid-cols-2">
            <div>
              <div className="relative min-h-24 overflow-hidden">
                {HOW_IT_WORKS_SLIDES.map((slide, index) => {
                  const caption = captionFor(slide, t.landing.howItWorks);
                  const active = reducedMotion ? index === STEP_COUNT - 1 : index === step;
                  return (
                    <div
                      key={index}
                      data-hiw-caption
                      data-active={active || undefined}
                      className="absolute inset-x-0 top-0 transition-[opacity,transform] duration-450 ease-in-out motion-reduce:transition-none data-active:pointer-events-auto data-active:translate-y-0 data-active:opacity-100 pointer-events-none translate-y-4 opacity-0"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                        {caption.step}
                      </p>
                      <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
                        {caption.title}
                      </h3>
                    </div>
                  );
                })}
              </div>
              <div className="mt-8 flex items-center gap-3">
                <div className="flex flex-1 gap-1.5" aria-hidden>
                  {HOW_IT_WORKS_SLIDES.map((_, index) => {
                    const activeIndex = reducedMotion ? STEP_COUNT - 1 : step;
                    return (
                      <span
                        key={index}
                        data-hiw-tick
                        className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
                          index <= activeIndex ? "bg-blue-600" : "bg-slate-200"
                        }`}
                      />
                    );
                  })}
                </div>
                <span
                  data-hiw-counter
                  data-hiw-step={reducedMotion ? STEP_COUNT : step + 1}
                  className="shrink-0 text-xs font-medium tabular-nums text-slate-400"
                >
                  {reducedMotion ? STEP_COUNT : step + 1} / {STEP_COUNT}
                </span>
              </div>
            </div>

            <div className="relative mx-auto h-[min(22rem,42vh)] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_12px_45px_rgba(15,23,42,0.06)] ring-1 ring-black/5 lg:h-[min(26.25rem,52vh)]">
              <div className="flex h-9 items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
              </div>

              {HOW_IT_WORKS_SLIDES.map((slide, index) => {
                const active = reducedMotion ? index === STEP_COUNT - 1 : index === step;
                return (
                  <div
                    key={index}
                    data-hiw-panel
                    data-kind={slide.kind}
                    data-active={active || undefined}
                    className={`group absolute inset-x-0 top-9 bottom-0 p-6 transition-[opacity,transform] duration-450 ease-in-out motion-reduce:transition-none ${
                      active
                        ? "z-10 translate-y-0 opacity-100"
                        : "z-0 pointer-events-none translate-y-4 opacity-0"
                    }`}
                  >
                    {slide.kind === "form" ? (
                      <FormSlide {...slide} />
                    ) : slide.kind === "upload" ? (
                      <UploadSlide />
                    ) : slide.kind === "universities" ? (
                      <UniversitiesSlide />
                    ) : slide.kind === "apply" ? (
                      <ApplySlide />
                    ) : (
                      <StatusSlide />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function captionFor(
  slide: HowItWorksSlide,
  copy: {
    documentsLabel: string;
    uploadTitle: string;
    universitiesLabel: string;
    chooseTitle: string;
    oneClickLabel: string;
    applyTitle: string;
    statusLabel: string;
    statusTitle: string;
  },
) {
  if (slide.kind === "form") return { step: slide.step, title: slide.title };
  if (slide.kind === "upload") return { step: copy.documentsLabel, title: copy.uploadTitle };
  if (slide.kind === "universities") return { step: copy.universitiesLabel, title: copy.chooseTitle };
  if (slide.kind === "apply") return { step: copy.oneClickLabel, title: copy.applyTitle };
  return { step: copy.statusLabel, title: copy.statusTitle };
}

function FormSlide({
  step,
  title,
  fields,
}: {
  step: string;
  title: string;
  fields: { label: string; labelEn: string; value: string }[];
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          data-hiw-progress
          className="h-full origin-left scale-x-0 rounded-full bg-blue-600 transition-transform duration-500 ease-linear motion-reduce:scale-x-100 group-data-active:scale-x-100"
        />
      </div>
      <p className="mt-3 text-xs font-semibold text-blue-600">{step}</p>
      <h3 className="mt-1 text-sm font-semibold text-slate-950">{title}</h3>

      <div className="mt-4 flex flex-col gap-2.5">
        {fields.map((field) => (
          <div key={field.labelEn}>
            <div className="text-[11px] text-slate-400">
              {field.label} / {field.labelEn}
            </div>
            <div className="mt-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800">
              {field.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UploadSlide() {
  const t = useT();

  return (
    <div className="flex h-full flex-col">
      <p className="text-xs font-semibold text-blue-600">{t.landing.howItWorks.documentsLabel}</p>
      <h3 className="mt-1 text-sm font-semibold text-slate-950">
        {t.landing.howItWorks.uploadTitle}
      </h3>
      <div className="mt-4 flex flex-col gap-2.5">
        {t.landing.howItWorks.mockDocuments.map((name, index) => (
          <div
            key={name}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
          >
            <span className="text-xs font-medium text-slate-800">{name}</span>
            <span
              data-hiw-check
              style={{ transitionDelay: `${index * 80}ms` }}
              className="flex h-5 w-5 scale-75 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 opacity-0 transition-all duration-300 ease-out motion-reduce:scale-100 motion-reduce:opacity-100 group-data-active:scale-100 group-data-active:opacity-100"
            >
              <CheckIcon />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UniversitiesSlide() {
  const t = useT();

  return (
    <div className="flex h-full flex-col">
      <p className="text-xs font-semibold text-blue-600">{t.landing.howItWorks.universitiesLabel}</p>
      <h3 className="mt-1 text-sm font-semibold text-slate-950">
        {t.landing.howItWorks.chooseTitle}
      </h3>
      <div className="mt-4 flex flex-col gap-2.5">
        {MOCK_UNIVERSITIES.map((university, index) => (
          <div
            key={university.name}
            className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
              university.picked
                ? "border-blue-200 bg-blue-50"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <span className="text-xs font-medium text-slate-800">
              {university.name}
            </span>
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-md border text-white ${
                university.picked
                  ? "border-blue-600 bg-blue-600"
                  : "border-slate-300 bg-white"
              }`}
            >
              {university.picked ? (
                <span
                  data-hiw-check
                  style={{ transitionDelay: `${index * 80}ms` }}
                  className="inline-flex scale-75 opacity-0 transition-all duration-300 ease-out motion-reduce:scale-100 motion-reduce:opacity-100 group-data-active:scale-100 group-data-active:opacity-100"
                >
                  <CheckIcon />
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApplySlide() {
  const t = useT();

  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <p className="text-xs font-semibold text-blue-600">{t.landing.howItWorks.oneClickLabel}</p>
      <h3 className="mt-1 text-sm font-semibold text-slate-950">
        {t.landing.howItWorks.applyTitle}
      </h3>

      <div className="relative mt-6 flex h-12 w-56 items-center justify-center">
        <div
          data-hiw-apply-loading
          className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white transition-opacity duration-200 motion-reduce:opacity-0 group-data-active:opacity-100"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          {t.landing.howItWorks.submitting}
        </div>
        <div
          data-hiw-apply-done
          className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white opacity-0 transition-opacity delay-200 duration-200 motion-reduce:opacity-100 group-data-active:opacity-100"
        >
          <CheckIcon />
          {APPLY_UNIVERSITY_COUNT} {t.landing.howItWorks.applicationsSubmitted}
        </div>
      </div>
    </div>
  );
}

function StatusSlide() {
  const t = useT();

  return (
    <div className="flex h-full flex-col">
      <p className="text-xs font-semibold text-blue-600">{t.landing.howItWorks.statusLabel}</p>
      <h3 className="mt-1 text-sm font-semibold text-slate-950">
        {t.landing.howItWorks.statusTitle}
      </h3>
      <div className="mt-4 flex flex-col gap-2.5">
        <StatusRow name="Peking University" tone="ring-emerald-100 bg-emerald-50 text-emerald-700" label={t.landing.howItWorks.statusSubmitted} />
        <StatusRow name="Nanjing University" tone="ring-emerald-100 bg-emerald-50 text-emerald-700" label={t.landing.howItWorks.statusSubmitted} />
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <span className="text-xs font-medium text-slate-800">
            Sichuan University
          </span>
          <span className="relative inline-flex h-5 w-24 shrink-0 items-center justify-end">
            <span
              data-hiw-status-a
              className="absolute right-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200 transition-opacity duration-150 motion-reduce:opacity-0 group-data-active:opacity-100"
            >
              {t.landing.howItWorks.statusDraft}
            </span>
            <span
              data-hiw-status-b
              className="absolute right-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 opacity-0 ring-1 ring-amber-100 transition-opacity duration-150 group-data-active:opacity-100 group-data-active:delay-150"
            >
              {t.landing.howItWorks.statusInProgress}
            </span>
            <span
              data-hiw-status-c
              className="absolute right-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 opacity-0 ring-1 ring-emerald-100 transition-opacity duration-150 motion-reduce:opacity-100 group-data-active:opacity-100 group-data-active:delay-300"
            >
              {t.landing.howItWorks.statusSubmitted}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  name,
  label,
  tone,
}: {
  name: string;
  label: string;
  tone: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <span className="text-xs font-medium text-slate-800">{name}</span>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tone}`}>
        {label}
      </span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m5 13 4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
