import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../core/config';

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

async function main() {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
    const result = await model.embedContent({
      content: { parts: [{ text: 'Hello world' }] },
      outputDimensionality: 768
    } as any);
    console.log('gemini-embedding-001 length with outputDimensionality=768:', result.embedding.values.length);
  } catch (e: any) {
    console.error('gemini-embedding-001 failed with outputDimensionality=768:', e.message);
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-embedding-2' });
    const result = await model.embedContent({
      content: { parts: [{ text: 'Hello world' }] },
      outputDimensionality: 768
    } as any);
    console.log('gemini-embedding-2 length with outputDimensionality=768:', result.embedding.values.length);
  } catch (e: any) {
    console.error('gemini-embedding-2 failed with outputDimensionality=768:', e.message);
  }
}

main().catch(console.error);
