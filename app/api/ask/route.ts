import { z } from "zod";
import type { BackendResponse, Citation, Confidence } from "@/lib/types";

const RAG_URL = process.env.RAG_URL;

/** Below this cosine-distance the passage is treated as a real match. */
const STRONG_DISTANCE = 0.4;
const WEAK_DISTANCE = 0.55;

const bodySchema = z.object({
  query: z.string().trim().min(3).max(1000),
  lang: z.enum(["en", "ur"]),
});

const NO_MATCH_MARKERS = ["دستیاب نہیں", "not available", "not found in"];

function normalizeUrl(url?: string) {
  const markdown = url?.match(/^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/);
  return markdown?.[1] ?? url;
}

function toCitations(sources: BackendResponse["sources"]): Citation[] {
  return sources.map((s, i) => ({
    n: i + 1,
    source: `Fatwa ${s.fatwa_number}${s.sub_category ? ` · ${s.sub_category}` : ""}`,
    excerpt: s.snippet,
    matchScore: Math.max(0, Math.min(1, 1 - s.distance)),
    url: normalizeUrl(s.url),
    category: s.category,
    subCategory: s.sub_category,
    fatwaNumber: s.fatwa_number,
  }));
}

function gradeConfidence(answer: string, cites: Citation[]): Confidence {
  if (cites.length === 0) return "review";
  if (NO_MATCH_MARKERS.some((m) => answer.includes(m))) return "review";
  const best = 1 - (cites[0]?.matchScore ?? 0);
  if (best > WEAK_DISTANCE) return "review";
  const strong = cites.filter((c) => 1 - c.matchScore <= STRONG_DISTANCE).length;
  // one lone strong passage is grounded; several weak ones that disagree are not
  return strong >= 1 ? "grounded" : "review";
}

/** The backend returns a plain answer string. Anchor it to the retrieved
 *  passages by appending markers for the passages actually used, so a marker
 *  never claims sentence-level grounding the backend did not provide. */
function withCitationMarkers(answer: string, cites: Citation[], confidence: Confidence): string {
  if (confidence !== "grounded" || cites.length === 0) return answer;
  if (/\{\{cite:\d+\}\}/.test(answer)) return answer;
  const used = cites.filter((c) => 1 - c.matchScore <= WEAK_DISTANCE).slice(0, 5);
  if (used.length === 0) return answer;
  return `${answer.trim()} ${used.map((c) => `{{cite:${c.n}}}`).join("")}`;
}

const sse = (event: string, data: unknown) =>
  new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export async function POST(request: Request) {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json(
            { message: "Send a question between 3 and 1000 characters." },
            { status: 400 },
          );
        }

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              if (!RAG_URL) {
                controller.enqueue(
                  sse("error", {
                    message: "The verification service is not configured.",
                  }),
                );
                return;
              }

              const upstream = await fetch(RAG_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: parsed.data.query }),
              });

              if (!upstream.ok) {
                controller.enqueue(
                  sse("error", {
                    message:
                      "The verification service returned an error. Wait a moment and ask again.",
                  }),
                );
                controller.close();
                return;
              }

              const data = (await upstream.json()) as BackendResponse;
              const citations = toCitations(data.sources ?? []);
              const confidence = gradeConfidence(data.answer ?? "", citations);
              const answer = withCitationMarkers(data.answer ?? "", citations, confidence);

              // progressive render: emit the answer in word-sized chunks
              if (confidence === "grounded") {
                const tokens = answer.split(/(\s+)/);
                let buf = "";
                for (const tk of tokens) {
                  buf += tk;
                  if (buf.length >= 12) {
                    controller.enqueue(sse("text", { text: buf }));
                    buf = "";
                    await new Promise((r) => setTimeout(r, 12));
                  }
                }
                if (buf) controller.enqueue(sse("text", { text: buf }));
              }

              controller.enqueue(sse("result", { answer, confidence, citations }));
            } catch {
              controller.enqueue(
                sse("error", {
                  message:
                    "Could not reach the verification service. Check your connection and ask again.",
                }),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
}
