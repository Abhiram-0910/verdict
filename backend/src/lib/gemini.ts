import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error('GEMINI_API_KEY is not set in the environment');
}

export const ai = new GoogleGenAI({ apiKey });

/**
 * Helper to call Gemini with robust 429 handling.
 * Retries up to 3 times with exponential backoff if a 429 (Too Many Requests) is encountered.
 */
export async function generateContentWithRetry(
  options: Parameters<typeof ai.models.generateContent>[0],
  maxRetries = 3
) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await ai.models.generateContent(options);
    } catch (error: any) {
      // Check for 429 Too Many Requests
      if (error?.status === 429 || error?.message?.includes('429')) {
        console.error('[Gemini] Raw 429 Error Body:', JSON.stringify(error, null, 2), error?.message);
        if (attempt >= maxRetries) {
          throw new Error(`Gemini API rate limit exceeded after ${maxRetries} retries.`);
        }
        const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.warn(`[Gemini] 429 encountered, retrying in ${Math.round(delayMs)}ms... (Attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt++;
      } else {
        throw error;
      }
    }
  }
  throw new Error('Unreachable');
}
