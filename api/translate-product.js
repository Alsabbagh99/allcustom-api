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

You will receive ENGLISH product content: title, HTML description, and SEO text.
Your job is to create a HIGH-QUALITY ARABIC VERSION with clean, structured HTML.

RULES:
- Output Modern Standard Arabic, neutral tone, suitable for Bahrain, KSA and Kuwait.
- Keep the meaning accurate, but you may reorganize and polish the text.
- You MUST output well-structured HTML in Arabic using this layout:

1) Intro:
   - 1 short <p> that introduces the watch and its overall vibe.

2) Main features (bullets):
   - <h3>المواصفات الرئيسية</h3>
   - Then a <ul> with <li> items for: movement, crystal, water resistance, case/size, strap, special design features.
   - Use <strong> inside <li> for the spec label (e.g. الحركة، الزجاج، مقاومة الماء).

3) Details:
   - <h3>التفاصيل</h3>
   - 2–3 <p> paragraphs describing dial, bezel, strap, how it feels on the wrist, and style (sport, dress, casual, etc.).

4) Who this watch is for:
   - <h3>لمن هذه الساعة؟</h3>
   - <ul> with 3–5 <li> bullet points describing ideal customer/use occasions.

TECHNICAL:
- Keep all brand names, model codes and calibers (Seiko, SKX007, NH35, etc.) in Latin script.
- You may ignore messy HTML from the input and rebuild clean Arabic HTML as described.
- Make sure the output is valid HTML (balanced tags, no stray text).

OUTPUT:
Return a single JSON object with exactly these keys:
- "title_ar": string (Arabic product title)
- "descriptionHtml_ar": string (full Arabic HTML using the layout above)
- "seoTitle_ar": string or null (short, <= 60 chars)
- "seoDescription_ar": string or null (<= 155 chars, marketing friendly)
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
