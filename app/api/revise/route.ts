import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SYSTEM_PROMPT =
  '너는 HTML 편집 도우미야. 사용자가 제공한 HTML 코드를 사용자의 지시사항에 맞게 수정해. 다른 설명이나 마크다운 코드블록 없이 수정된 전체 HTML 코드만 응답해.';

interface ReviseRequestBody {
  html: string;
  instruction: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ReviseRequestBody = await request.json();
    const { html, instruction } = body;

    if (!html || !instruction) {
      return NextResponse.json(
        { error: 'html, instruction은 필수 입력값입니다.' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    const userPrompt = `[현재 HTML 코드]\n${html}\n\n[수정 지시사항]\n${instruction}`;

    let result;
    try {
      result = await model.generateContent(userPrompt);
    } catch (error) {
      const isOverloaded = error instanceof GoogleGenerativeAIFetchError && error.status === 503;
      if (!isOverloaded) throw error;
      await sleep(1500);
      result = await model.generateContent(userPrompt);
    }

    const text = result.response.text().trim();
    const cleaned = text
      .replace(/^```(?:html)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    return NextResponse.json({ html: cleaned });
  } catch (error) {
    console.error('[revise] Gemini API 호출 실패:', error);

    if (error instanceof GoogleGenerativeAIFetchError) {
      if (error.status === 429) {
        return NextResponse.json(
          { error: 'Gemini API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.' },
          { status: 429 }
        );
      }
      if (error.status === 503) {
        return NextResponse.json(
          { error: 'Gemini 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요.' },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: `Gemini API 호출 중 오류가 발생했습니다. (status: ${error.status ?? '알 수 없음'})` },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: '코드 수정 요청 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
