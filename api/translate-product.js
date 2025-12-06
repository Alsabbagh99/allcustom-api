
// api/translate-product.js

const SHOPIFY_API_VERSION = "2024-07";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res
        .status(405)
        .json({ ok: false, error: "Method not allowed. Use POST." });
    }

    const { handle } = req.body || {};

    if (!handle || typeof handle !== "string") {
      return res
        .status(400)
        .json({ ok: false, error: "Missing or invalid 'handle' in body" });
    }

    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!storeDomain || !adminToken || !openaiKey) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing environment variables. Check SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, OPENAI_API_KEY.",
      });
    }

    // 1) Fetch product from Shopify by handle
    const shopifyQuery = `
      query getProductByHandle($handle: String!) {
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

    const shopifyRes = await fetch(
      `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
        body: JSON.stringify({
          query: shopifyQuery,
          variables: { handle },
        }),
      }
    );

    const shopifyJson = await shopifyRes.json();

    if (!shopifyRes.ok || shopifyJson.errors) {
      console.error("Shopify error:", shopifyJson);
      return res.status(500).json({
        ok: false,
        error: "Shopify API error when fetching product",
        details: shopifyJson.errors || shopifyJson,
      });
    }

    const product = shopifyJson.data?.productByHandle;
    if (!product) {
      return res
        .status(404)
        .json({ ok: false, error: `No product found with handle "${handle}"` });
    }

    const { id, title, descriptionHtml, seo } = product;

    // 2) Ask OpenAI for Arabic translations
    const systemPrompt = `
You are a professional Arabic copywriter and translator for a premium watch e-commerce website in the GCC.
Translate and adapt the given English product content into clear, modern, professional Arabic suitable for online product pages.

Requirements:
- Keep the meaning accurate, but you may slightly adapt phrases to sound natural in Arabic.
- Preserve all HTML tags in descriptionHtml (such as <p>, <strong>, <ul>, <li>, <h2>). Only translate the visible text.
- Use Modern Standard Arabic with a neutral tone, suitable for customers from Bahrain, KSA and Kuwait.
- Keep brand names, model names, and technical terms (e.g. Seiko, SKX007, NH35) in Latin script.
- Return a single JSON object with exactly these keys:
  - "title_ar" (string)
  - "descriptionHtml_ar" (string, with HTML)
  - "seoTitle_ar" (string or null)
  - "seoDescription_ar" (string or null)
If any English field is missing, set the corresponding Arabic field to null.
    `.trim();

    const userPayload = {
      title,
      descriptionHtml,
      seoTitle: seo?.title ?? null,
      seoDescription: seo?.description ?? null,
    };

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      }),
    });

    const openaiJson = await openaiRes.json();

    if (!openaiRes.ok) {
      console.error("OpenAI error:", openaiJson);
      return res.status(500).json({
        ok: false,
        error: "OpenAI API error",
        details: openaiJson,
      });
    }

    const content = openaiJson?.choices?.[0]?.message?.content || "{}";

    let translations;
    try {
      translations = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse OpenAI JSON:", content);
      return res.status(500).json({
        ok: false,
        error: "Failed to parse OpenAI response as JSON",
        raw: content,
      });
    }

    // 3) Build TranslationInput[] for Shopify (Arabic locale "ar")
    const translationInputs = [];

    if (translations.title_ar) {
      translationInputs.push({
        locale: "ar",
        key: "title",
        value: translations.title_ar,
      });
    }

    if (translations.descriptionHtml_ar) {
      translationInputs.push({
        locale: "ar",
        key: "descriptionHtml",
        value: translations.descriptionHtml_ar,
      });
    }

    // (SEO keys are trickier; for now we rely on Shopify using translated title/description for SEO)

    let registerResult = null;

    if (translationInputs.length > 0) {
      const registerMutation = `
        mutation translationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
          translationsRegister(resourceId: $resourceId, translations: $translations) {
            userErrors {
              message
              field
            }
            translations {
              key
              locale
              value
            }
          }
        }
      `;

      const registerRes = await fetch(
        `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": adminToken,
          },
          body: JSON.stringify({
            query: registerMutation,
            variables: {
              resourceId: id,
              translations: translationInputs,
            },
          }),
        }
      );

      const registerJson = await registerRes.json();

      if (!registerRes.ok || registerJson.errors) {
        console.error("translationsRegister error:", registerJson);
        return res.status(500).json({
          ok: false,
          error: "Shopify translationsRegister API error",
          details: registerJson.errors || registerJson,
        });
      }

      registerResult = registerJson.data?.translationsRegister || null;
    }

    return res.status(200).json({
      ok: true,
      productId: id,
      handle,
      original: {
        title,
        descriptionHtml,
        seoTitle: seo?.title ?? null,
        seoDescription: seo?.description ?? null,
      },
      translations,
      shopifyTranslationsRegister: registerResult,
    });
  } catch (err) {
    console.error("Unexpected error in /api/translate-product:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Unexpected server error" });
  }
}
