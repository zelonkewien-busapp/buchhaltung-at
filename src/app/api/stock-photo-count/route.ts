import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type OpenAIOutput = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Bitte zuerst anmelden." }, { status: 401 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY fehlt auf dem Server." }, { status: 503 });
    }

    const form = await request.formData();
    const image = form.get("image");
    const rawProductIds = form.get("productIds");
    if (!(image instanceof File) || typeof rawProductIds !== "string") {
      return NextResponse.json({ error: "Foto oder Produktliste fehlt." }, { status: 400 });
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.type)) {
      return NextResponse.json({ error: "Bitte ein JPG-, PNG- oder WebP-Foto verwenden." }, { status: 415 });
    }
    if (image.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Das Foto ist zu groß. Bitte ein kleineres Foto aufnehmen." }, { status: 413 });
    }

    let requestedIds: unknown;
    try {
      requestedIds = JSON.parse(rawProductIds);
    } catch {
      return NextResponse.json({ error: "Die Produktliste ist ungültig." }, { status: 400 });
    }
    if (!Array.isArray(requestedIds) || requestedIds.length === 0 || requestedIds.length > 100 ||
      requestedIds.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "Keine zählbaren Produkte für diesen Kühlschrank gefunden." }, { status: 400 });
    }
    const productIds = [...new Set(requestedIds as string[])];

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id,name,category,unit")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .in("id", productIds);
    if (productsError) {
      return NextResponse.json({ error: "Produktliste konnte nicht geladen werden." }, { status: 500 });
    }
    if (!products?.length) {
      return NextResponse.json({ error: "Keine passenden Produkte gefunden." }, { status: 400 });
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    const imageData = `data:${image.type};base64,${bytes.toString("base64")}`;
    const productEnum = products.map((product) => product.id);
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              productId: { type: "string", enum: productEnum },
              quantity: { type: "integer", minimum: 0, maximum: 500 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["productId", "quantity", "confidence"],
          },
        },
      },
      required: ["items"],
    };

    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        max_output_tokens: 3000,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Zähle die auf dem Foto klar sichtbaren Getränkebehälter, die zu den folgenden Produkten passen. Produktliste: ${JSON.stringify(products.map(({ id, name, category, unit }) => ({ id, name, category, unit })))}. Gib für jedes Produkt genau einen Eintrag zurück. Zähle nur sichtbare Behälter und schätze keine verdeckten Flaschen. Wenn du ein Produkt nicht erkennst, gib quantity 0 und confidence 0 zurück. confidence beschreibt, wie sicher Produktzuordnung und Zählung zusammen sind. Das Ergebnis ist nur ein Vorschlag, also keine Mengen erfinden.`,
            },
            { type: "input_image", image_url: imageData, detail: "high" },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "fridge_stock_count",
            strict: true,
            schema,
          },
        },
      }),
    });

    if (!openAIResponse.ok) {
      return NextResponse.json({ error: "OpenAI konnte das Foto nicht analysieren. Prüfe API-Schlüssel und API-Guthaben." }, { status: 502 });
    }
    const openAIResult = await openAIResponse.json() as OpenAIOutput;
    const outputText = openAIResult.output_text ?? openAIResult.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text;
    if (!outputText) {
      return NextResponse.json({ error: "Die Fotoanalyse hat kein Zählergebnis geliefert." }, { status: 502 });
    }

    const parsed = JSON.parse(outputText) as {
      items?: Array<{ productId: string; quantity: number; confidence: number }>;
    };
    const productById = new Map(products.map((product) => [product.id, product]));
    const items = (parsed.items ?? []).flatMap((item) => {
      const product = productById.get(item.productId);
      if (!product || !Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > 500 ||
        !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) return [];
      return [{
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        confidence: item.confidence,
      }];
    });

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Fotoanalyse fehlgeschlagen. Bitte erneut versuchen." }, { status: 500 });
  }
}
