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
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  // Detect if user is asking about hospitals
  const hospitalKeywords = ['hospital', 'மருத்துவமனை', 'ஆஸ்பத்திரி', 'doctor', 'மருத்துவர்', 'treatment', 'சிகிச்சை', 'clinic', 'கிளினிக்'];
  const isHospitalQuery = hospitalKeywords.some(k => message.toLowerCase().includes(k.toLowerCase()));

  // Detect if user is asking about bus
  const busKeywords = ['bus', 'பஸ்', 'பேருந்து', 'timing', 'நேரம்', 'route', 'ரூட்', 'transport', 'போக்குவரத்து'];
  const isBusQuery = busKeywords.some(k => message.toLowerCase().includes(k.toLowerCase()));

  try {
    // HOSPITAL QUERY — use OpenStreetMap
    if (isHospitalQuery && lat && lon) {
      const radius = 5000; // 5km radius
      const overpassQuery = `
        [out:json][timeout:25];
        (
          node["amenity"="hospital"](around:${radius},${lat},${lon});
          way["amenity"="hospital"](around:${radius},${lat},${lon});
          node["amenity"="clinic"](around:${radius},${lat},${lon});
          node["healthcare"="hospital"](around:${radius},${lat},${lon});
        );
        out body;
        >;
        out skel qt;
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
          let distance = '';
          if (hlat && hlon) {
            const d = getDistance(lat, lon, hlat, hlon);
            distance = ` (${d} km)`;
          }
          return `${e.tags.name}${distance}`;
        })
        .slice(0, 5);

      if (hospitals.length > 0) {
        const hospitalList = hospitals.join('\n');

        // Use Gemini to format the response in Tamil
        const prompt = `You are VAANI. The user asked about nearby hospitals in ${language}.
Here are the nearest hospitals found:
${hospitalList}

Format this as a helpful, warm response in ${language} language.
List the hospitals clearly with their distances.
Also mention they can call 104 for free medical helpline.
Keep it under 120 words.`;

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

        const geminiData = await geminiRes.json();
        const reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || hospitalList;
        return res.status(200).json({ reply: reply.trim(), hospitals });
      } else {
        // No hospitals found nearby — ask Gemini
        const prompt = `You are VAANI. User asked about hospitals near them in ${language} but no nearby hospitals were found in OpenStreetMap.
Tell them in ${language} to:
1. Call Tamil Nadu health helpline: 104
2. Visit nearest PHC (Primary Health Centre)
3. Check https://www.tnhealth.tn.gov.in for hospital list
Keep it under 80 words and be helpful.`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 300, temperature: 0.5 }
            })
          }
        );
        const geminiData = await geminiRes.json();
        const reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || 'No hospitals found nearby.';
        return res.status(200).json({ reply: reply.trim() });
      }
    }

    // BUS QUERY — use Gemini with TNSTC knowledge
    if (isBusQuery) {
      const prompt = `You are VAANI, an expert on Tamil Nadu government bus services (TNSTC, MTC, SETC).
User asked in ${language}: "${message}"

Give accurate information about:
- Bus routes and numbers if mentioned
- Approximate timings based on TNSTC/MTC schedules
- How to check real-time bus info via: 
  * TNSTC website: www.tnstc.in
  * MTC Chennai app
  * Call TNSTC: 044-24794000

Answer ONLY in ${language} language. Keep under 100 words. Be specific and helpful.`;

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
      const geminiData = await geminiRes.json();
      const reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, could not get bus info.';
      return res.status(200).json({ reply: reply.trim() });
    }

    // ALL OTHER QUERIES — General Gemini
    const prompt = `You are VAANI, an expert Indian government services assistant for Tamil Nadu.
Answer ONLY in ${language} language. Keep answers under 100 words. Be simple, accurate and clear.
Help with: ration cards, hospitals, bus timings, Aadhaar, PAN card, government schemes, welfare schemes.
For Tamil Nadu specific info, mention relevant department names and helpline numbers.
User question: ${message}`;

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

    const data = await geminiRes.json();
    if (data.error) {
      return res.status(500).json({ error: 'Gemini API error: ' + data.error.message });
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    if (!reply) {
      return res.status(500).json({ error: 'No reply from Gemini', raw: JSON.stringify(data) });
    }

    return res.status(200).json({ reply: reply.trim() });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};

// Calculate distance between two coordinates in km
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c).toFixed(1);
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

module.exports = handler;