require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ✅ Request Queue & Rate Limiting
const requestQueue = [];
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 5; // Max parallel requests
const REQUEST_TIMEOUT = 120000; // 2 minutes timeout

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Request ID Generator
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ✅ Health Check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Image Style Conversion API Running 🚀',
    activeRequests,
    queueLength: requestQueue.length,
    maxConcurrent: MAX_CONCURRENT_REQUESTS
  });
});

// 🎯 Intensity Controller
function getStyleModifier(intensity) {
  if (intensity <= 30) {
    return "very subtle style, keep close to original, minimal change";
  } else if (intensity <= 60) {
    return "balanced style, noticeable but realistic transformation";
  } else {
    return "strong stylization, fully transformed artistic look";
  }
}

// 🔄 Process Request (with concurrency control)
async function processImageGeneration(reqId, prompt, imageBase64, intensity) {
  try {
    console.log(`[${reqId}] 🎯 Starting (Active: ${activeRequests}/${MAX_CONCURRENT_REQUESTS})`);

    // Step 1: Extract base description
    const visionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageBase64 },
            },
            {
              type: 'text',
              text: `Describe this image in a simple and clear way. Focus on subject, objects, colors, and composition. Do NOT add any artistic style.`,
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    const baseDescription = visionResponse.choices[0].message.content;
    console.log(`[${reqId}] 🧠 Description ready`);

    // Step 2: Build final prompt
    const styleModifier = getStyleModifier(intensity);

    const finalPrompt = `
${baseDescription}

Apply this style: ${prompt}

Style intensity: ${intensity}/100

Instructions:
- Keep same subject and composition
- Do not change structure
- Do not add new objects

Style strength: ${styleModifier}
`;

    console.log(`[${reqId}] 🎨 Generating image...`);

    // Step 3: Generate
    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt: finalPrompt,
      size: "1024x1024",
    });

    const imageBase64Result = result.data[0].b64_json;
    console.log(`[${reqId}] ✅ Complete`);

    return {
      success: true,
      image: `data:image/png;base64,${imageBase64Result}`,
    };

  } catch (error) {
    console.error(`[${reqId}] 💥 ERROR:`, error.message);
    throw error;
  }
}

// 🚀 Main API Endpoint with Queue Management
app.post('/api/generate', async (req, res) => {
  const reqId = generateRequestId();
  const { prompt, imageBase64, intensity = 50 } = req.body;

  console.log(`[${reqId}] 📥 New request (Queue: ${requestQueue.length}, Active: ${activeRequests})`);

  // Validate input
  if (!prompt || !imageBase64) {
    return res.status(400).json({
      success: false,
      error: 'Missing prompt or imageBase64',
    });
  }

  // Set timeout for request
  const timeout = setTimeout(() => {
    console.error(`[${reqId}] ⏰ Request timeout`);
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: 'Request timeout',
      });
    }
  }, REQUEST_TIMEOUT);

  // Process request with concurrency control
  const processRequest = async () => {
    activeRequests++;
    
    try {
      const result = await processImageGeneration(reqId, prompt, imageBase64, intensity);
      clearTimeout(timeout);
      
      if (!res.headersSent) {
        res.json(result);
      }
    } catch (error) {
      clearTimeout(timeout);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    } finally {
      activeRequests--;
      console.log(`[${reqId}] 🔚 Finished (Active: ${activeRequests}, Queue: ${requestQueue.length})`);
      
      // Process next in queue
      if (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
        const nextRequest = requestQueue.shift();
        nextRequest();
      }
    }
  };

  // Queue or process immediately
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    processRequest();
  } else {
    console.log(`[${reqId}] ⏳ Queued (Position: ${requestQueue.length + 1})`);
    requestQueue.push(processRequest);
  }
});

// ✅ Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, closing server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// 🚀 Start Server
const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║  ✅ Server running on port ${PORT}    ║
║  🤖 GPT-Image-1 (Image-to-Image)   ║
║  🔐 Secure with .env               ║
║  ⚡ Max ${MAX_CONCURRENT_REQUESTS} concurrent requests      ║
║  ⏱️  ${REQUEST_TIMEOUT/1000}s timeout per request       ║
╚════════════════════════════════════╝
  `);
});