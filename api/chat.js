const handler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, language } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'No message provided' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const prompt = `You are VAANI, an expert Indian government services assistant who gives accurate, helpful, and specific answers.

User is speaking in ${language}. You MUST answer ONLY in ${language} language.

Rules:
- Give ACCURATE and SPECIFIC information about Indian government services
- If asked about ration shop items: explain what items are available (rice, wheat, dal, sugar, kerosene), how to check eligibility, and how to get them
- If asked about hospitals: mention government hospitals, how to register, free treatment schemes like Ayushman Bharat
- If asked about bus timings: suggest checking local RTC website or app, and give general guidance
- If asked about Aadhaar: explain update process, enrollment centers, helpline 1947
- If asked about PAN card: explain how to apply on NSDL/UTIITSL website
- If asked about government schemes: give accurate scheme names and benefits
- Keep answers under 100 words
- Be helpful, warm, and clear
- NEVER give vague or incomplete answers

User question: ${message}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            maxOutputTokens: 400,
            temperature: 0.5
          }
        })
      }
    );

    const data = await geminiRes.json();

    if (data.error) {
      return res.status(500).json({
        error: 'Gemini API error: ' + data.error.message,
        code: data.error.code
      });
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;

    if (!reply) {
      return res.status(500).json({
        error: 'No reply from Gemini',
        raw: JSON.stringify(data)
      });
    }

    return res.status(200).json({ reply: reply.trim() });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};

module.exports = handler;