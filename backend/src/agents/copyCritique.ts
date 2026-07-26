import { z } from 'zod';
import { generateContentWithRetry } from '../lib/gemini.js';
import { Type } from '@google/genai';
import { db } from '../db/client.js';
import { copyFinding } from '../db/schema.js';

export type CopyCritiqueFailureReason = 'AI_RATE_LIMIT' | 'AI_MALFORMED_OUTPUT' | 'DB_WRITE_FAILED' | 'UNKNOWN';

const copyFindingSchema = z.object({
  category: z.string(),
  description: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string()
});

const responseValidator = z.object({
  findings: z.array(copyFindingSchema)
});

export type CopyFindingInput = z.infer<typeof copyFindingSchema>;

export type CopyCritiqueResult = 
  | { success: true; findings: CopyFindingInput[] }
  | { success: false; reason: CopyCritiqueFailureReason; detail: string };

export async function runCopyCritique(auditJobId: string, renderedText: string | null): Promise<CopyCritiqueResult> {
  if (!renderedText || renderedText.trim().length === 0) {
    return { success: true, findings: [] };
  }

  const systemInstruction = "You are an expert copywriter and conversion optimization specialist. Analyze the provided webpage text for clarity, messaging, strong calls to action (CTAs), and trust signals. Return your findings as a JSON array.";
  const prompt = `Analyze the following webpage copy:\n\n${renderedText}\n\nIdentify any issues that negatively impact trust, clarity, or conversion. E.g. ambiguous messaging, weak CTAs, or missing trust signals.`;

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
                  category: { type: Type.STRING, description: "e.g. five_second | cta_copy | trust_signal" },
                  description: { type: Type.STRING },
                  severity: { type: Type.STRING, enum: ["high", "medium", "low"] },
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
            { text: prompt }
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

  let findings: CopyFindingInput[];
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
          confidence: f.confidence.toString(),
          reasoning: f.reasoning
        }));
        await tx.insert(copyFinding).values(rowsToInsert);
      });
    } catch (err: any) {
      return { success: false, reason: 'DB_WRITE_FAILED', detail: err.message || String(err) };
    }
  }

  return { success: true, findings };
}
