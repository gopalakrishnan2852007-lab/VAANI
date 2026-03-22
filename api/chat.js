// api/chat.js — This IS the backend (Vercel Serverless Function)
// Your Gemini API key stays SECRET here, never exposed to users

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, language, langCode } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'No message provided' });
  }

  // API key is stored in Vercel Environment Variables (NEVER in frontend code)
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const prompt = `You are VAANI, a helpful Indian government services assistant. 
The user is speaking in ${language}. 
Answer ONLY in ${language} language.
Keep answers short, simple, and clear — under 80 words.
Help with: ration cards, hospitals, bus timings, Aadhaar, PAN card, government schemes.
If not government-related, politely say you only help with government services.

User question: ${message}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.7 }
        })
      }
    );

    if (!geminiRes.ok) {
      const errData = await geminiRes.json();
      throw new Error(errData.error?.message || 'Gemini API error');
    }

    const data = await geminiRes.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, no response generated.';

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('Gemini error:', err.message);
    return res.status(500).json({ error: 'AI service error: ' + err.message });
  }
}
