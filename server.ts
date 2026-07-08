import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables (.env.local takes precedence, per README setup instructions)
dotenv.config({ path: [".env.local", ".env"] });

const app = express();
const PORT = 3000;

// Set body parser to handle large base64 screenshot images
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// Initialize Gemini API Client
let ai: GoogleGenAI | null = null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (GEMINI_API_KEY && GEMINI_API_KEY !== "MY_GEMINI_API_KEY") {
  try {
    ai = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    console.log("Gemini API Client initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Gemini API client:", error);
  }
} else {
  console.log("GEMINI_API_KEY not set. /api/extract will return 503 until it is configured in .env.local.");
}

// API Route for screenshot analysis
app.post("/api/extract", async (req, res) => {
  try {
    const { image } = req.body; // base64 data URL string

    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "이미지 데이터가 누락되었습니다." });
    }

    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_API_KEY가 설정되지 않아 분석을 수행할 수 없습니다. .env.local 파일을 확인해주세요.",
      });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const mimeType = image.match(/^data:(image\/\w+);base64,/)?.[1] || "image/png";

    console.log("Calling Gemini 3.5 Flash for screenshot OCR & place extraction...");

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data,
          },
        },
        {
          text: `You are an advanced South Korean Place Extractor and OCR engine.
Analyze this screenshot (from Instagram, Blog, Map, or Chat) and do the following:
1. Extract all text via OCR.
2. Search and infer the business/place name (가게명/장소명) and the specific region/neighborhood in South Korea (e.g. 성수동, 한남동, 홍대, 강릉, 제주 등).
3. Determine its category exactly as one of the following: "카페", "식당", "펜션/숙소", "관광지/기타".
4. Gather or simulate realistic high-quality Google Places data for this place:
   - Full exact Korean address (도로명 주소).
   - Accurate South Korea Latitude and Longitude (near Seoul or its identified region) so it can be correctly plotted on our Leaflet map. (Crucial: MUST be in South Korea, Latitude around 35.0-38.5, Longitude around 126.0-129.5).
   - Standard Operating Hours in Korean (영업시간).
   - Representative menu items (대표 메뉴) up to 3 items, showing name and price (e.g., "15,000원").
   - A detailed Korean review summary (리뷰 요약) reflecting the overall public feedback (around 2-3 sentences).
   - A short snippet of the extracted text or hashtag that led to this detection.

You MUST respond strictly in JSON format matching the schema provided.`,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: "The name of the place (e.g., 어니언 성수, 난포 성수).",
            },
            category: {
              type: Type.STRING,
              description: "Must be exactly one of: '카페', '식당', '펜션/숙소', '관광지/기타'",
            },
            address: {
              type: Type.STRING,
              description: "The complete South Korean road address (도로명 주소).",
            },
            latitude: {
              type: Type.NUMBER,
              description: "The latitude coordinate (e.g., 37.5446). Must be in South Korea.",
            },
            longitude: {
              type: Type.NUMBER,
              description: "The longitude coordinate (e.g., 127.0559). Must be in South Korea.",
            },
            hours: {
              type: Type.STRING,
              description: "Operating hours (e.g., 매일 11:00 - 22:00).",
            },
            menu: {
              type: Type.ARRAY,
              description: "List of 2-3 popular menu items.",
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "Menu name." },
                  price: { type: Type.STRING, description: "Menu price (e.g., 12,000원)." },
                },
                required: ["name", "price"],
              },
            },
            reviewSummary: {
              type: Type.STRING,
              description: "A summary of user reviews in Korean (2-3 sentences, engaging and helpful).",
            },
            screenshotText: {
              type: Type.STRING,
              description: "Brief extracted OCR text or hashtags from the image.",
            },
          },
          required: [
            "name",
            "category",
            "address",
            "latitude",
            "longitude",
            "hours",
            "menu",
            "reviewSummary",
            "screenshotText",
          ],
        },
      },
    });

    const jsonText = response.text?.trim();
    if (!jsonText) {
      throw new Error("Gemini returned an empty response.");
    }

    const data = JSON.parse(jsonText);

    // Validate latitude/longitude — without valid coordinates the pin cannot be placed
    data.latitude = Number(data.latitude);
    data.longitude = Number(data.longitude);
    if (isNaN(data.latitude) || isNaN(data.longitude)) {
      throw new Error(`Invalid coordinates in Gemini response: ${data.latitude}, ${data.longitude}`);
    }

    console.log("Extracted Place Data successfully:", data.name, `Coords: ${data.latitude}, ${data.longitude}`);
    return res.json(data);
  } catch (error) {
    console.error("Error in /api/extract:", error);
    return res.status(500).json({
      error: "장소 분석에 실패했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
});

// Start Express server and integrate Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development middleware attached.");
  } else {
    // Production Mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving static files from dist/ folder.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Pinsnap Server] Running on http://localhost:${PORT}`);
  });
}

startServer();
