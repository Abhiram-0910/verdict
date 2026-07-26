import { z } from 'zod';
import { generateContentWithRetry } from '../lib/gemini.js';
import { Type } from '@google/genai';
import { db } from '../db/client.js';
import { visualFinding } from '../db/schema.js';

export type VisualCritiqueFailureReason = 'AI_RATE_LIMIT' | 'AI_MALFORMED_OUTPUT' | 'FETCH_FAILED' | 'DB_WRITE_FAILED' | 'UNKNOWN';

const visualFindingSchema = z.object({
  category: z.string(),
  description: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  screenshotRegion: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  }).partial().nullable().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string()
});

const responseValidator = z.object({
  findings: z.array(visualFindingSchema)
});

export type VisualFindingInput = z.infer<typeof visualFindingSchema>;

export type VisualCritiqueResult = 
  | { success: true; findings: VisualFindingInput[] }
  | { success: false; reason: VisualCritiqueFailureReason; detail: string };

export async function runVisualCritique(auditJobId: string, desktopScreenshotUrl: string): Promise<VisualCritiqueResult> {
  let base64Data: string;
  let mimeType: string;

  try {
    const res = await fetch(desktopScreenshotUrl);
    if (!res.ok) {
      return { success: false, reason: 'FETCH_FAILED', detail: `Status: ${res.status} ${res.statusText}` };
    }
    const arrayBuffer = await res.arrayBuffer();
    base64Data = Buffer.from(arrayBuffer).toString('base64');
    mimeType = res.headers.get('content-type') || 'image/png';
  } catch (err: any) {
    return { success: false, reason: 'FETCH_FAILED', detail: err.message || String(err) };
  }

  const systemInstruction = "You are an expert UX/UI designer and conversion rate optimization specialist. Analyze the provided webpage screenshot for visual hierarchy, clutter, CTA visibility, and design aesthetics. Return your findings as a JSON array.";
  const prompt = `Identify any visual issues that negatively impact user experience or conversion. Focus on high-level layout, contrast, spacing, and visual clarity. Do NOT critique the text itself.`;

  let responseText: string | null = null;
  try {
    const response = await generateContentWithRetry({
      model: 'gemini-3.1-flash-lite',
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            findings: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING, description: "e.g. hierarchy | clutter | cta_visibility" },
                  description: { type: Type.STRING },
                  severity: { type: Type.STRING, enum: ["high", "medium", "low"] },
                  screenshotRegion: {
                    type: Type.OBJECT,
                    nullable: true,
                    properties: {
                      x: { type: Type.NUMBER },
                      y: { type: Type.NUMBER },
                      width: { type: Type.NUMBER },
                      height: { type: Type.NUMBER },
                    },
                  },
                  confidence: { type: Type.NUMBER, description: "Confidence score 0.0 to 1.0" },
                  reasoning: { type: Type.STRING, description: "Your stated reasoning for this finding" }
                },
                required: ["category", "description", "severity", "confidence", "reasoning"]
              }
            }
          },
          required: ["findings"]
        },
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Data } }
          ]
        }
      ]
    });
    responseText = response.text || null;
  } catch (err: any) {
    const isRateLimit = err.message?.includes('rate limit exceeded') || err.status === 429;
    return { 
      success: false, 
      reason: isRateLimit ? 'AI_RATE_LIMIT' : 'UNKNOWN', 
      detail: err.message || String(err) 
    };
  }

  if (!responseText) {
    return { success: false, reason: 'AI_MALFORMED_OUTPUT', detail: 'Gemini returned empty text response' };
  }

  let findings: VisualFindingInput[];
  try {
    const parsed = JSON.parse(responseText);
    const result = responseValidator.safeParse(parsed);
    if (!result.success) {
      return { success: false, reason: 'AI_MALFORMED_OUTPUT', detail: result.error.message };
    }
    findings = result.data.findings;
  } catch (err: any) {
    return { success: false, reason: 'AI_MALFORMED_OUTPUT', detail: 'JSON parse error: ' + err.message };
  }

  if (findings.length > 0) {
    try {
      await db.transaction(async (tx) => {
        const rowsToInsert = findings.map(f => ({
          auditJobId,
          category: f.category,
          description: f.description,
          severity: f.severity,
          screenshotRegion: f.screenshotRegion || null,
          confidence: f.confidence.toString(),
          reasoning: f.reasoning
        }));
        await tx.insert(visualFinding).values(rowsToInsert);
      });
    } catch (err: any) {
      return { success: false, reason: 'DB_WRITE_FAILED', detail: err.message || String(err) };
    }
  }

  return { success: true, findings };
}
