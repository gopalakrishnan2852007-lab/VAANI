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

  const prompt = `You are VAANI, a helpful Indian government services assistant.
Answer ONLY in ${language} language. Keep answers under 80 words. Be simple and clear.
Help with: ration cards, hospitals, bus timings, Aadhaar, PAN card, government schemes.
User question: ${message}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
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
            maxOutputTokens: 300,
            temperature: 0.7
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