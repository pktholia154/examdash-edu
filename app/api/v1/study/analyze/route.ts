import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

/**
 * On-demand High-Thinking Syllabus Analysis Endpoint (/api/v1/study/analyze)
 * Strictly manual/on-demand only (zero background or public page runtime calls).
 */
export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        error:
          'Gemini API key is not configured. Attach an API key in Settings > Secrets to enable deep study analysis.',
      },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  let prompt = '';
  try {
    const body = (await req.json()) as { prompt?: string };
    prompt = (body.prompt || '').trim().slice(0, 4000);
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  if (!prompt) {
    return NextResponse.json(
      { error: 'Prompt is required.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-carbon',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an academic exam strategist for ExamDash. Provide concise, structured topic weightage and revision tactics in plain markdown.',
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH,
        },
      },
    });

    return NextResponse.json(
      { text: response.text ?? '' },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Analysis request failed';
    return NextResponse.json(
      { error: msg },
      { status: 502, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
