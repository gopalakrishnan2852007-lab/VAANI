const handler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, language, langCode, lat, lon } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'No message provided' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set in environment variables');
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const hospitalKeywords = ['hospital', 'மருத்துவமனை', 'ஆஸ்பத்திரி', 'doctor', 'மருத்துவர்', 'treatment', 'சிகிச்சை', 'clinic', 'अस्पताल', 'चिकित्सा', 'ആശുപത്രി', 'వైద్యశాల'];
  const isHospitalQuery = hospitalKeywords.some(k => message.toLowerCase().includes(k.toLowerCase()));

  const busKeywords = ['bus', 'பஸ்', 'பேருந்து', 'timing', 'நேரம்', 'route', 'transport', 'బస్', 'बस', 'ബസ്'];
  const isBusQuery = busKeywords.some(k => message.toLowerCase().includes(k.toLowerCase()));

  const callGemini = async (prompt) => {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.5 }
        })
      }
    );

    if (!geminiRes.ok) {
      const errData = await geminiRes.json();
      console.error('Gemini API error response:', JSON.stringify(errData));
      throw new Error('Gemini API error: ' + (errData.error?.message || geminiRes.status));
    }

    const data = await geminiRes.json();

    if (data.error) {
      console.error('Gemini returned error in body:', JSON.stringify(data.error));
      throw new Error('Gemini error: ' + data.error.message);
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    if (!reply) {
      console.error('Gemini returned empty reply. Raw:', JSON.stringify(data));
      throw new Error('Empty reply from Gemini');
    }

    return reply.trim();
  };

  try {
    // HOSPITAL QUERY — OpenStreetMap
    if (isHospitalQuery && lat && lon) {
      const overpassQuery = `
        [out:json][timeout:25];
        (
          node["amenity"="hospital"](around:5000,${lat},${lon});
          way["amenity"="hospital"](around:5000,${lat},${lon});
          node["amenity"="clinic"](around:5000,${lat},${lon});
          node["healthcare"="hospital"](around:5000,${lat},${lon});
        );
        out body; >; out skel qt;
      `;

      const osmRes = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(overpassQuery)
      });

      const osmData = await osmRes.json();
      const hospitals = osmData.elements
        .filter(e => e.tags && e.tags.name)
        .map(e => {
          const hlat = e.lat || (e.center && e.center.lat);
          const hlon = e.lon || (e.center && e.center.lon);
          let dist = '';
          if (hlat && hlon) dist = ' (' + getDistance(lat, lon, hlat, hlon) + ' km)';
          return e.tags.name + dist;
        })
        .slice(0, 5);

      const hospitalPrompt = hospitals.length > 0
        ? `You are VAANI. The user asked about nearby hospitals. You MUST reply ONLY in ${language} language — no English at all.
Here are the nearest hospitals found:
${hospitals.join('\n')}
Format this as a helpful warm response in ${language}. List hospitals with distances. Also mention free medical helpline 104. Under 120 words.`
        : `You are VAANI. The user asked about hospitals but none were found nearby. You MUST reply ONLY in ${language} language — no English at all.
Tell them to: call Tamil Nadu health helpline 104, visit nearest PHC, or check tnhealth.tn.gov.in. Under 80 words.`;

      const reply = await callGemini(hospitalPrompt);
      return res.status(200).json({ reply, hospitals });
    }

    // BUS QUERY
    if (isBusQuery) {
      const busPrompt = `You are VAANI, an expert on Tamil Nadu government bus services (TNSTC, MTC, SETC).
You MUST reply ONLY in ${language} language — no English at all.
User asked: "${message}"
Give accurate info about bus routes/timings. Mention: TNSTC website www.tnstc.in, MTC Chennai app, TNSTC helpline 044-24794000. Under 100 words.`;
      const reply = await callGemini(busPrompt);
      return res.status(200).json({ reply });
    }

    // GENERAL QUERY
    const prompt = `You are VAANI. The user is speaking in ${language}.
You MUST reply ONLY in ${language} language — no English at all.
Answer questions about Indian government services: ration cards, hospitals, bus timings, Aadhaar, PAN card, government schemes, Tamil Nadu welfare schemes.
Give accurate, helpful, specific answers with helpline numbers where relevant.
Keep answer under 100 words.
User question: ${message}`;

    const reply = await callGemini(prompt);
    return res.status(200).json({ reply });

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1);
}

module.exports = handler;