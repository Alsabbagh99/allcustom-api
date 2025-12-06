
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
    const productQuery = `
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
      console.error("Shopify product error:", productJson);
      return res.status(500).json({
        ok: false,
        error: "Shopify API error when fetching product",
        details: productJson.errors || productJson,
      });
    }

    const product = productJson.data?.productByHandle;
    if (!product) {
      return res
        .status(404)
        .json({ ok: false, error: `No product found with handle "${handle}"` });
    }

    const { id, title, descriptionHtml, seo } = product;

    // 2) Get translatable content digests for this product (for default locale, usually "en")
    const translatableQuery = `
      query getTranslatableResource($id: ID!) {
        translatableResource(resourceId: $id) {
          resourceId
          translatableContent {
            key
            locale
            digest
          }
        }
      }
    `;

    const translatableRes = await fetch(
      `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
        body: JSON.stringify({
          query: translatableQuery,
          variables: { id },
        }),
      }
    );

    const translatableJson = await translatableRes.json();

    if (!translatableRes.ok || translatableJson.errors) {
      console.error("Shopify translatableResource error:", translatableJson);
      return res.status(500).json({
        ok: false,
        error: "Shopify API error when fetching translatable content",
        details: translatableJson.errors || translatableJson,
      });
    }

    const translatableContent =
      translatableJson.data?.translatableResource?.translatableContent || [];

    // Build a map: key -> digest for the primary locale (assume "en")
    const digestByKey = {};
    for (const item of translatableContent) {
      if (item.locale === "en") {
        digestByKey[item.key] = item.digest;
      }
    }

    // 3) Ask OpenAI for Arabic translations
    const systemPrompt = `
You are a professional Arabic copywriter and translator for a premium watch e-commerce website in the GCC.

You will receive a product's HTML description and SEO text in ENGLISH.
Your job is to translate ONLY the visible text into clear, modern, professional ARABIC.

VERY IMPORTANT RULES ABOUT HTML:
- The input description is HTML. You MUST keep the EXACT SAME HTML structure.
- Do NOT remove, add, or reorder HTML tags. Preserve all tags such as <p>, <strong>, <b>, <u>, <em>, <h2>, <h3>, <ul>, <li>, <br>.
- If the English text uses bullet points (<ul><li>), the Arabic version MUST also stay as bullet points with the same number of <li> items.
- If the English text uses bold or underlined text (<strong>, <b>, <u>), keep the same tags around the corresponding Arabic words.
- Do NOT translate tag names or attributes, only the text between the tags.
- Keep numbers, model codes (e.g. NH35, SKX007), and brand names (Seiko, AllCustom, etc.) in Latin script.

STYLE:
- Modern Standard Arabic, neutral tone, suitable for Bahrain, KSA, and Kuwait.
- Keep meaning accurate but make sentences natural in Arabic.

OUTPUT:
Return a single JSON object with exactly these keys:
- "title_ar": string
- "descriptionHtml_ar": string (valid HTML with the SAME structure as the input)
- "seoTitle_ar": string or null
- "seoDescription_ar": string or null
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

    // 4) Build TranslationInput[] for Shopify (Arabic locale "ar") including digests
    const translationInputs = [];

    if (translations.title_ar && digestByKey["title"]) {
      translationInputs.push({
        locale: "ar",
        key: "title",
        value: translations.title_ar,
        translatableContentDigest: digestByKey["title"],
      });
    }

    if (translations.descriptionHtml_ar && digestByKey["descriptionHtml"]) {
      translationInputs.push({
        locale: "ar",
        key: "descriptionHtml",
        value: translations.descriptionHtml_ar,
        translatableContentDigest: digestByKey["descriptionHtml"],
      });
    }

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
