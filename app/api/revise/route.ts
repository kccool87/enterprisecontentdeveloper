import { NextRequest, NextResponse } from 'next/server';
import { callAI, AIError } from '@/lib/aiClient';

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

    const userPrompt = `[현재 HTML 코드]\n${html}\n\n[수정 지시사항]\n${instruction}`;

    const text = await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, json: false });

    const cleaned = text
      .trim()
      .replace(/^```(?:html)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    return NextResponse.json({ html: cleaned });
  } catch (error) {
    console.error('[revise] AI API 호출 실패:', error);

    if (error instanceof AIError) {
      if (error.status === 429) {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
      if (error.status === 500) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    return NextResponse.json(
      { error: '코드 수정 요청 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
