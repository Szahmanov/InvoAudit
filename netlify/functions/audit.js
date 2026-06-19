exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return json(500, { error: "Missing GROQ_API_KEY in Netlify environment variables." });
    }

    const body = JSON.parse(event.body || "{}");
    const { imageBase64, mimeType, history = [] } = body;

    if (!imageBase64 || !mimeType) {
      return json(400, { error: "Missing image." });
    }

    if (!mimeType.startsWith("image/")) {
      return json(400, {
        error: "За v1 качи снимка на фактурата. Ако имаш PDF, направи screenshot на страницата и качи изображението."
      });
    }

    const prompt = `
Ти си InvoAudit AI — автономен финансов инспектор за български фактури.

ЗАДАЧА:
Прочети фактурата от изображението. Извлечи данните. Провери математиката, ЕИК/ДДС номер, IBAN структура и възможни аномалии спрямо локалната история.

НЕ си счетоводител и НЕ даваш финансов/правен съвет. Даваш автоматична предварителна проверка.

Върни САМО валиден JSON без markdown.

История от предишни проверки:
${JSON.stringify(history).slice(0, 6000)}

JSON формат:
{
  "vendorName": "име на доставчик или null",
  "invoiceNumber": "номер на фактура или null",
  "invoiceDate": "дата или null",
  "eik": "ЕИК или null",
  "vatNumber": "ДДС номер или null",
  "iban": "IBAN или null",
  "currency": "BGN/EUR/null",
  "subtotal": number или null,
  "vat": number или null,
  "total": number или null,
  "riskScore": number от 0 до 100,
  "status": "approved" или "warning" или "rejected",
  "summaryBg": "кратко заключение на български",
  "checks": [
    {
      "name": "име на проверката",
      "passed": true/false,
      "severity": "low/medium/high",
      "explanationBg": "обяснение на български"
    }
  ],
  "anomalies": [
    {
      "title": "име на аномалия",
      "severity": "low/medium/high",
      "explanationBg": "обяснение"
    }
  ],
  "recommendedActionBg": "какво да направи потребителят преди плащане"
}

ПРАВИЛА:
- Ако subtotal и total са налични, провери дали subtotal * 1.20 ≈ total.
- Ако VAT е наличен, провери дали subtotal + VAT ≈ total.
- Български ЕИК обикновено е 9 или 13 цифри.
- Български ДДС номер често започва с BG + ЕИК.
- Български IBAN започва с BG и има 22 символа.
- Ако има същия invoiceNumber в историята, маркирай high anomaly.
- Ако един и същ IBAN се появява с различни фирми, маркирай high anomaly.
- Ако данните са нечетливи, status трябва да е warning или rejected.
`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0.1,
        max_tokens: 1800,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`
                }
              }
            ]
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      return json(500, { error: data.error?.message || "Groq API error." });
    }

    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return json(200, parsed);
  } catch (err) {
    return json(500, { error: err.message || "Unknown server error." });
  }
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(payload)
  };
}
