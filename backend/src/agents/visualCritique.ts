import { z } from 'zod';
import { db } from '../db/client.js';
import { visualFinding } from '../db/schema.js';
import { getProvider } from '../providers/index.js';
import type { ProviderName } from '../providers/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

export type VisualCritiqueFailureReason = 'AI_RATE_LIMIT' | 'AI_MALFORMED_OUTPUT' | 'FETCH_FAILED' | 'DB_WRITE_FAILED' | 'UNKNOWN' | 'INVALID_API_KEY' | 'TIMEOUT';

const visualFindingSchema = z.object({
  category: z.string(),
  description: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  screenshotRegion: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1)
  }).nullable().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string()
});

export const responseValidator = z.object({
  findings: z.array(visualFindingSchema)
});

export type VisualFindingInput = z.infer<typeof visualFindingSchema>;

export type VisualCritiqueResult = 
  | { success: true; findings: VisualFindingInput[] }
  | { success: false; reason: VisualCritiqueFailureReason; detail: string };

export interface ByokContext {
  provider: ProviderName;
  apiKey: string;
  modelId: string;
}

export async function runVisualCritique(auditJobId: string, desktopScreenshotUrl: string, byok?: ByokContext): Promise<VisualCritiqueResult> {
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
  const prompt = `Identify any visual issues that negatively impact user experience or conversion. Focus on high-level layout, contrast, spacing, and visual clarity. Do NOT critique the text itself.
  
If you can precisely locate the specific element being critiqued, provide its 'screenshotRegion' using a percentage-based coordinate system where x, y, width, and height are floats between 0.0 and 1.0 (with 0,0 at the top-left). If you cannot confidently and precisely locate it, or if the issue applies to the whole page, set 'screenshotRegion' to null. Do NOT approximate or guess a plausible-looking box.`;

  const providerName = byok?.provider || 'gemini';
  const apiKey = byok?.apiKey || process.env.GEMINI_API_KEY || '';
  const modelId = byok?.modelId || 'gemini-3.1-flash-lite';

  const provider = getProvider(providerName);
  const jsonSchema = zodToJsonSchema(responseValidator, { target: 'jsonSchema7' }) as Record<string, unknown>;

  const critiqueResult = await provider.critique({
    systemInstruction,
    prompt,
    image: { base64Data, mimeType },
    modelId,
    apiKey,
    jsonSchema
  });

  if (!critiqueResult.success) {
    return critiqueResult;
  }

  const responseText = critiqueResult.text;

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
