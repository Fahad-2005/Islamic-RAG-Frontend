"use client";

import { useState } from "react";
import { segmentAnswer } from "@/lib/api";
import type { Citation } from "@/lib/types";
import { isRtlText, useLang } from "@/lib/lang";
import { CitationMarker } from "./CitationMarker";

export function AnswerCard({
  answer,
  citations,
  activeCitation,
  onActivate,
  streaming = false,
}: {
  answer: string;
  citations: Citation[];
  activeCitation: number | null;
  onActivate: (n: number) => void;
  streaming?: boolean;
}) {
  const { t } = useLang();
  const rtl = isRtlText(answer);
  const segments = segmentAnswer(answer);
  const [showFullSource, setShowFullSource] = useState(false);

  return (
    <article className="panel p-6 sm:p-8" aria-busy={streaming}>
      <h2 className="font-display text-[26px] text-text">{t("Answer", "جواب")}</h2>
      <hr className="rule my-5" />

      {/* Concise Direct Answer */}
      <div
        dir={rtl ? "rtl" : "ltr"}
        className={`whitespace-pre-wrap text-[16px] text-text ${rtl ? "font-urdu" : "leading-[1.75]"}`}
      >
        {segments.map((seg, i) =>
          seg.kind === "text" ? (
            <span key={i}>{seg.value}</span>
          ) : (
            <CitationMarker
              key={i}
              n={seg.n}
              sourceTitle={citations.find((c) => c.n === seg.n)?.source ?? `#${seg.n}`}
              active={activeCitation === seg.n}
              onActivate={onActivate}
            />
          ),
        )}
        {streaming && (
          <span
            aria-hidden="true"
            className="ml-1 inline-block h-[1em] w-[2px] translate-y-[2px] bg-gold"
          />
        )}
      </div>

      {/* Toggle Button for Full Text / Classical References */}
      {citations.length > 0 && (
        <div className="mt-4 pt-3 border-t border-rule flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowFullSource(!showFullSource)}
            className="font-ui text-[13px] text-gold hover:underline cursor-pointer"
          >
            {showFullSource
              ? t("Hide full reference text", "مکمل حوالہ متن چھپائیں")
              : t("View full fatwa reference text", "مکمل فتویٰ و حوالہ جات دیکھیں")}
          </button>
        </div>
      )}

      {/* Expandable Raw Snippet */}
      {showFullSource && citations[0] && (
        <div
          dir={rtl ? "rtl" : "ltr"}
          className={`mt-3 p-4 rounded-lg bg-surface border border-rule text-[14px] text-text-dim whitespace-pre-wrap ${rtl ? "font-urdu" : "leading-[1.6]"}`}
        >
          <p className="font-bold text-text mb-2">
            {t("Original Reference Text:", "اصلی متن و حوالہ جات:")}
          </p>
          {citations[0].excerpt}
        </div>
      )}

      <hr className="rule my-6" />
      <p className="font-ui text-[13px] italic text-text-dim">
        {t(
          "Compiled from the cited fatawa only. It is not a substitute for a qualified scholar's ruling.",
          "یہ جواب صرف مذکورہ فتاویٰ سے مرتب کیا گیا ہے اور کسی مستند عالم کے فتوے کا بدل نہیں۔",
        )}
      </p>
    </article>
  );
}