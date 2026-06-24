import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const imageDataUrl = body.imageDataUrl as string | undefined;

    if (!imageDataUrl) {
      return NextResponse.json({ altText: '' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ altText: '' });
    }

    // data:image/jpeg;base64,... 파싱
    const dataUrlMatch = /^data:([^;]+);base64,(.+)$/.exec(imageDataUrl);
    if (!dataUrlMatch) {
      return NextResponse.json({ altText: '' });
    }

    const [, mimeType, base64Data] = dataUrlMatch;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      generationConfig: { maxOutputTokens: 300 },
    });

    const result = await model.generateContent([
      {
        inlineData: { mimeType, data: base64Data },
      },
      'LG U+ 기업 블로그에 사용할 이 이미지의 ALT 태그 텍스트를 작성해줘. ' +
        '한국어로 100자 이내, 이미지 주요 내용을 간결하고 구체적으로 설명해. ' +
        'ALT 텍스트만 출력하고 따옴표·불필요한 설명은 제외해.',
    ]);

    const altText = result.response.text().trim().replace(/^["']|["']$/g, '').slice(0, 150);
    return NextResponse.json({ altText });
  } catch (error) {
    console.error('[generate-alt] error:', error);
    return NextResponse.json({ altText: '' });
  }
}
