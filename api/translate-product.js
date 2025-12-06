// api/translate-product.js
// HTML-aware Arabic translator for Shopify products

const SHOPIFY_API_VERSION = "2024-07";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res
        .status(405)
        .json({ ok: false, error: "Method not allowed. Use POST." });
    }

    const { handle } = req.body || {};
    if (!handle) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing required field: handle" });
    }

    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!storeDomain || !adminToken) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing Shopify env vars. Check SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN.",
      });
    }
    if (!openaiKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing OPENAI_API_KEY environment variable.",
      });
    }

    // 1) Fetch product by handle from Shopify
    const productQuery = `
      query productByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
          descriptionHtml
          seo {
            title
            description
          }
        }
      }
    `;

    const productRes = await fetch(
      `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
        body: JSON.stringify({
          query: productQuery,
          variables: { handle },
        }),
      }
    );

    const productJson = await productRes.json();

    if (!productRes.ok || productJson.errors) {
      console.error("Shopify productByHandle error:", productJson);
      return res.status(500).json({
        ok: false,
        error: "Shopify productByHandle API error",
        details: productJson.errors || productJson,
      });
    }

    const product = productJson.data?.productByHandle;
    if (!product) {
      return res
        .status(404)
        .json({ ok: false, error: `No product found for handle "${handle}"` });
    }

    const title_en = product.title || "";
    const descriptionHtml_en = product.descriptionHtml || "";
    const seoTitle_en = product.seo?.title || "";
    const seoDescription_en = product.seo?.description || "";

    // 2) Extract text segments from HTML (outside of tags)
    const segments = extractTextSegments(descriptionHtml_en);
    // Array of strings to translate
    const segmentTexts = segments.map((s) => s.text);

    // 3) Ask OpenAI to translate title, SEO, and each segment
    const systemPrompt = `
You are a professional Arabic translator for a premium watch e-commerce website in the GCC.

You will receive JSON with:
- "title_en": the English product title
- "seoTitle_en": SEO title (may be empty)
- "seoDescription_en": SEO description (may be empty)
- "segments": an array of English text segments extracted from HTML, in order

Your job:
- Translate all English text into Modern Standard Arabic suitable for Bahrain, KSA, and Kuwait.
- DO NOT add or remove items from the "segments" array.
- "segments_ar" MUST have exactly the same length as "segments" and match by index.

CRITICAL:
- You are translating ONLY the text, NOT the HTML tags.
- The server will insert these translations back into the original HTML, so do not include < or > or HTML tags in the segment translations.
- Keep brand names and model codes (Seiko, SKX007, NH35, etc.) in Latin script.

Return valid JSON with exactly:
{
  "title_ar": string,
  "seoTitle_ar": string or null,
  "seoDescription_ar": string or null,
  "segments_ar": string[]  // same length and order as "segments"
}
`.trim();

    const openaiPayload = {
      title_en,
      seoTitle_en,
      seoDescription_en,
      segments: segmentTexts,
    };

    const oaRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify(openaiPayload),
          },
        ],
      }),
    });

    const oaJson = await oaRes.json();

    if (!oaRes.ok) {
      console.error("OpenAI error:", oaJson);
      return res.status(500).json({
        ok: false,
        error: "OpenAI translation API error",
        details: oaJson,
      });
    }

    const content = oaJson.choices?.[0]?.message?.content || "";
    let translationData;
    try {
      translationData = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse OpenAI JSON content:", content);
      return res.status(500).json({
        ok: false,
        error: "Could not parse OpenAI JSON response",
        details: content,
      });
    }

    const {
      title_ar,
      seoTitle_ar = null,
      seoDescription_ar = null,
      segments_ar,
    } = translationData || {};

    if (!Array.isArray(segments_ar)) {
      return res.status(500).json({
        ok: false,
        error: "OpenAI response missing segments_ar array",
        details: translationData,
      });
    }

    if (segments_ar.length !== segments.length) {
      console.error(
        "Segment length mismatch:",
        segments.length,
        "vs",
        segments_ar.length
      );
      return res.status(500).json({
        ok: false,
        error:
          "Mismatch between segments and segments_ar length in OpenAI response",
        details: {
          expected: segments.length,
          got: segments_ar.length,
        },
      });
    }

    // 4) Rebuild descriptionHtml with translated segments
    const descriptionHtml_ar = rebuildHtmlWithTranslations(
      descriptionHtml_en,
      segments,
      segments_ar
    );

    // 5) Register translations in Shopify
    const translationMutation = `
      mutation translationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
        translationsRegister(resourceId: $resourceId, translations: $translations) {
          translations {
            key
            locale
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const translationsInput = [
      {
        key: "title",
        locale: "ar",
        value: title_ar || "",
      },
      {
        key: "descriptionHtml",
        locale: "ar",
        value: descriptionHtml_ar,
      },
      {
        key: "seo.title",
        locale: "ar",
        value: seoTitle_ar,
      },
      {
        key: "seo.description",
        locale: "ar",
        value: seoDescription_ar,
      },
    ];

    const registerRes = await fetch(
      `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
        body: JSON.stringify({
          query: translationMutation,
          variables: {
            resourceId: product.id,
            translations: translationsInput,
          },
        }),
      }
    );

    const registerJson = await registerRes.json();

    if (!registerRes.ok || registerJson.errors) {
      console.error("Shopify translationsRegister error:", registerJson);
      return res.status(500).json({
        ok: false,
        error: "Shopify translationsRegister API error",
        details: registerJson.errors || registerJson,
      });
    }

    const userErrors =
      registerJson.data?.translationsRegister?.userErrors || [];
    if (userErrors.length > 0) {
      console.error("translationsRegister userErrors:", userErrors);
      return res.status(400).json({
        ok: false,
        error: "Shopify translationsRegister userErrors",
        userErrors,
      });
    }

    return res.status(200).json({
      ok: true,
      productId: product.id,
      handle,
      translations: {
        title_ar,
        seoTitle_ar,
        seoDescription_ar,
      },
      shopifyTranslationsRegister:
        registerJson.data?.translationsRegister?.translations || [],
    });
  } catch (err) {
    console.error("Unexpected error in /api/translate-product:", err);
    return res.status(500).json({
      ok: false,
      error: "Unexpected server error in translate-product",
    });
  }
}

/**
 * Extracts text segments from an HTML string (outside of tags),
 * with their start/end indices.
 */
function extractTextSegments(html) {
  const segments = [];
  let insideTag = false;
  let currentText = "";
  let currentStart = 0;

  for (let i = 0; i < html.length; i++) {
    const ch = html[i];

    if (ch === "<") {
      // starting a tag, close any open text segment
      if (!insideTag && currentText !== "") {
        segments.push({
          start: currentStart,
          end: i,
          text: currentText,
        });
        currentText = "";
      }
      insideTag = true;
    } else if (ch === ">") {
      insideTag = false;
    } else {
      if (!insideTag) {
        if (currentText === "") {
          currentStart = i;
        }
        currentText += ch;
      }
    }
  }

  if (!insideTag && currentText !== "") {
    segments.push({
      start: currentStart,
      end: html.length,
      text: currentText,
    });
  }

  return segments;
}

/**
 * Rebuilds HTML by replacing each text segment with the
 * corresponding translation, leaving all tags untouched.
 */
function rebuildHtmlWithTranslations(html, segments, translations) {
  let result = "";
  let lastIndex = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const translatedText = translations[i];

    result += html.slice(lastIndex, seg.start);
    result += translatedText;
    lastIndex = seg.end;
  }

  result += html.slice(lastIndex);
  return result;
}
