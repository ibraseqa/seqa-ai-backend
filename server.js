const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
require('dotenv').config();

// Initialize Express app
const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Hugging Face API setup
const HF_API_URL = 'https://api-inference.huggingface.co/models/distilgpt2';
const HF_API_KEY = process.env.HUGGING_FACE_API_KEY;

// Helper to query Hugging Face API
async function queryHuggingFace(prompt) {
    try {
        const response = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: prompt,
                parameters: { 
                    max_length: 50, 
                    temperature: 0.7, 
                    top_p: 0.9, 
                    num_return_sequences: 1,
                    do_sample: true,
                    return_full_text: false
                }
            })
        });
        if (!response.ok) {
            throw new Error(`Hugging Face API returned status ${response.status}`);
        }
        const data = await response.json();
        return data[0]?.generated_text || "I couldn’t generate a good answer!";
    } catch (error) {
        console.error('Hugging Face Error:', error.message);
        return "Sorry, I hit a snag with my language model!";
    }
}

// API endpoint for assistant
app.post('/api/assistant', async (req, res) => {
    const { question } = req.body;

    try {
        // Fetch data from Supabase
        const { data: salesmen, error: salesmenError } = await supabase.from('salesmen').select('*');
        if (salesmenError) throw new Error('Failed to fetch salesmen: ' + salesmenError.message);

        const { data: repairDevices, error: repairError } = await supabase.from('repair_devices').select('*');
        if (repairError) throw new Error('Failed to fetch repair devices: ' + repairError.message);

        // Simple intent detection with regex (faster than NLP for now)
        const lowerQuestion = question.toLowerCase();
        const isCounting = /(how many|number of|count)/i.test(lowerQuestion);
        const isDevices = /devices/i.test(lowerQuestion);
        const isRepair = /repair/i.test(lowerQuestion);
        const isSalesmen = /salesm(a|e)n/i.test(lowerQuestion);

        // Handle counting devices in repair locally (fast!)
        if (isCounting && isDevices && isRepair) {
            const count = repairDevices.length;
            const answer = `${count} device${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} in repair.`;
            res.json({ answer });
            return;
        }

        // Summarize data for context (for HF API)
        const salesmenSummary = `There are ${salesmen.length} salesmen with fields: name, company (e.g., ALSAD), branch (e.g., Jeddah), device_type (e.g., EDA52), soti (true/false).`;
        const repairSummary = `There are ${repairDevices.length} devices in repair with fields: serial_number, company (e.g., ALSAD), branch (e.g., Jeddah), status (e.g., Pending), device_type (e.g., EDA52), printer_type.`;

        // Compile prompt for HF API (only for non-counting queries)
        const prompt = `You are a helpful assistant with access to salesmen and repair device data. Answer the question naturally and concisely based on this context:\n${salesmenSummary}\n${repairSummary}\nQuestion: ${question}\nAnswer:`;

        // Call Hugging Face API
        let answer = await queryHuggingFace(prompt);

        // Clean up response
        answer = answer.trim();
        if (answer.startsWith("Answer:")) answer = answer.replace("Answer:", "").trim();

        // Truncate if repetitive
        const words = answer.split(" ");
        if (words.length > 5 && new Set(words).size < words.length / 2) {
            answer = words.slice(0, 5).join(" ") + "… (I started repeating myself!)";
        }

        // Fallback if too short or unhelpful
        if (answer.length < 5 || answer.toLowerCase() === question.toLowerCase()) {
            answer = "I’m not sure I got that right. Could you rephrase your question about salesmen or repair devices? I can help with counts, statuses, companies, branches, and more!";
        }

        res.json({ answer });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ answer: 'Something went wrong on my end. Please try again!' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});